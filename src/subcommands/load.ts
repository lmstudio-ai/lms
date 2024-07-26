import { makeTitledPrettyError, type SimpleLogger, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import {
  type DownloadedModel,
  type LLMLlamaAccelerationOffloadRatio,
} from "@lmstudio/lms-shared-types";
import { type LLMLoadModelConfig, type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import { boolean, command, flag, option, optional, positional, string, type Type } from "cmd-ts";
import fuzzy from "fuzzy";
import inquirer from "inquirer";
import inquirerPrompt from "inquirer-autocomplete-prompt";
import { getCliPref } from "../cliPref";
import { createClient, createClientArgs } from "../createClient";
import { formatElapsedTime } from "../formatElapsedTime";
import { formatSizeBytes1000 } from "../formatSizeBytes1000";
import { createLogger, logLevelArgs } from "../logLevel";
import { ProgressBar } from "../ProgressBar";

const gpuOptionType: Type<string, LLMLlamaAccelerationOffloadRatio> = {
  async from(str) {
    str = str.trim().toLowerCase();
    if (str === "off") {
      return 0;
    } else if (str === "auto") {
      return "auto";
    } else if (str === "max") {
      return 1;
    }
    const num = +str;
    if (Number.isNaN(num)) {
      throw new Error("Not a number");
    }
    if (num < 0 || num > 1) {
      throw new Error("Number out of range, must be between 0 and 1");
    }
    return num;
  },
  displayName: "0-1|off|auto|max",
  description: `a number between 0 to 1, or one of "off", "auto", "max"`,
};

const positiveIntegerOptionType: Type<string, number> = {
  async from(str) {
    const num = +str;
    if (Number.isNaN(num)) {
      throw new Error("Not a number");
    }
    if (Number.isInteger(num) === false) {
      throw new Error("Not an integer");
    }
    if (num <= 0) {
      throw new Error("Number out of range, must be greater than 0");
    }
    return num;
  },
  displayName: "number",
  description: `a positive integer`,
};

export const load = command({
  name: "load",
  description: "Load a model",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
    path: positional({
      type: optional(string),
      description: text`
        The path of the model to load. If not provided, you will be prompted to select one. If
        multiple models match the path, you will also be prompted to select one. If you don't wish
        to be prompted, please use the --exact or the --yes flag.
      `,
      displayName: "path",
    }),
    gpu: option({
      type: gpuOptionType,
      long: "gpu",
      description: text`
        How much to offload to the GPU. If "off", GPU offloading is disabled. If "max", all layers
        are offloaded to GPU. If "auto", LM Studio will decide how much to offload to the GPU. If a
        number between 0 and 1, that fraction of layers will be offloaded to the GPU.
      `,
      defaultValue: () => "auto" as const,
    }),
    contextLength: option({
      type: optional(positiveIntegerOptionType),
      long: "context-length",
      description: text`
        The number of tokens to consider as context when generating text. If not provided, the
        default value will be used.
      `,
    }),
    yes: flag({
      type: boolean,
      long: "yes",
      short: "y",
      description: text`
        Suppress all confirmations and warnings. Useful for scripting. If there are multiple
        models matching the path, the first one will be loaded. Fails if the path provided does not
        match any model.
      `,
    }),
    exact: flag({
      type: boolean,
      long: "exact",
      description: text`
        Only load the model if the path provided matches the model exactly. Fails if the path
        provided does not match any model.
      `,
    }),
    identifier: option({
      type: optional(string),
      long: "identifier",
      description: text`
        The identifier to assign to the loaded model. The identifier can be used to refer to the
        model in the API.
      `,
    }),
  },
  handler: async args => {
    const { gpu, contextLength, yes, exact, identifier } = args;
    const loadConfig: LLMLoadModelConfig = {
      gpuOffload: {
        ratio: gpu,
        mainGpu: 0,
        tensorSplit: [0],
      },
      contextLength,
    };
    let { path } = args;
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    const cliPref = await getCliPref(logger);

    const lastLoadedModels = cliPref.get().lastLoadedModels ?? [];
    const lastLoadedIndexToPathMap = [...lastLoadedModels.entries()];
    const lastLoadedMap = new Map(lastLoadedIndexToPathMap.map(([index, path]) => [path, index]));
    logger.debug(`Last loaded map loaded with ${lastLoadedMap.size} models.`);

    const models = (await client.system.listDownloadedModels())
      .filter(model => !model.architecture?.toLowerCase().includes("clip"))
      .filter(model => model.type === "llm")
      .sort((a, b) => {
        const aIndex = lastLoadedMap.get(a.path) ?? lastLoadedMap.size + 1;
        const bIndex = lastLoadedMap.get(b.path) ?? lastLoadedMap.size + 1;
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0;
      });

    if (exact) {
      const model = models.find(model => model.path === path);
      if (path === undefined) {
        logger.errorWithoutPrefix(
          makeTitledPrettyError(
            "Path not provided",
            text`
              The parameter ${chalk.cyanBright("[path]")} is required when using the
              ${chalk.yellowBright("--exact")} flag.
            `,
          ).message,
        );
        process.exit(1);
      }
      if (model === undefined) {
        const shortestName = models.reduce((shortest, model) => {
          if (model.path.length < shortest.length) {
            return model.path;
          }
          return shortest;
        }, models[0].path);
        logger.errorWithoutPrefix(
          makeTitledPrettyError(
            "Model not found",
            text`
              No model found with path being exactly "${chalk.yellowBright(path)}".

              To disable exact matching, remove the ${chalk.yellowBright("--exact")} flag.

              To see a list of all downloaded models, run:

                  ${chalk.yellowBright("lms ls --detailed")}

              Note, you need to provide the full model path. For example:

                  ${chalk.yellowBright(`lms load --exact "${chalk.yellow(shortestName)}"`)}
            `,
          ).message,
        );
        process.exit(1);
      }
      await loadModel(logger, client, model, identifier, loadConfig);
      return;
    }

    const modelPaths = models.map(model => model.path);

    const initialFilteredModels = fuzzy.filter(path ?? "", modelPaths);
    logger.debug("Initial filtered models length:", initialFilteredModels.length);

    let model: DownloadedModel;
    if (yes) {
      if (initialFilteredModels.length === 0) {
        logger.errorWithoutPrefix(
          makeTitledPrettyError(
            "Model not found",
            text`
              No model found that matches path "${chalk.yellowBright(path)}".

              To see a list of all downloaded models, run:

                  ${chalk.yellowBright("lms ls --detailed")}

              To select a model interactively, remove the ${chalk.yellowBright("--yes")} flag:

                  ${chalk.yellowBright("lms load")}
            `,
          ).message,
        );
        process.exit(1);
      }
      if (initialFilteredModels.length > 1) {
        logger.warnText`
          ${initialFilteredModels.length} models match the provided path. Loading the first one.
        `;
      }
      model = models[initialFilteredModels[0].index];
    } else {
      console.info();
      if (path === undefined) {
        model = await selectModelToLoad(models, modelPaths, "", 4, lastLoadedMap);
      } else if (initialFilteredModels.length === 0) {
        console.info(
          chalk.redBright(text`
            ! Cannot find a model matching the provided path (${chalk.yellowBright(path)}). Please
            select one from the list below.
          `),
        );
        path = "";
        model = await selectModelToLoad(models, modelPaths, path, 5, lastLoadedMap);
      } else if (initialFilteredModels.length === 1) {
        model = models[initialFilteredModels[0].index];
        // console.info(
        //   text`
        //     ! Confirm model selection, or select a different model.
        //   `,
        // );
        // model = await selectModelToLoad(models, modelPaths, path ?? "", 5, lastLoadedMap);
      } else {
        console.info(
          text`
            ! Multiple models match the provided path. Please select one.
          `,
        );
        model = await selectModelToLoad(models, modelPaths, path ?? "", 5, lastLoadedMap);
      }
    }

    const modelInLastLoadedModelsIndex = lastLoadedModels.indexOf(model.path);
    if (modelInLastLoadedModelsIndex !== -1) {
      logger.debug("Removing model from last loaded models:", model.path);
      lastLoadedModels.splice(modelInLastLoadedModelsIndex, 1);
    }
    lastLoadedModels.unshift(model.path);
    logger.debug("Updating cliPref");
    cliPref.setWithProducer(draft => {
      // Keep only the last 20 loaded models
      draft.lastLoadedModels = lastLoadedModels.slice(0, 20);
    });

    await loadModel(logger, client, model, identifier, loadConfig);
  },
});

async function selectModelToLoad(
  models: DownloadedModel[],
  modelPaths: string[],
  initialSearch: string,
  leaveEmptyLines: number,
  _lastLoadedMap: Map<string, number>,
) {
  console.info(
    chalk.gray("! Use the arrow keys to navigate, type to filter, and press enter to select."),
  );
  console.info();
  const prompt = inquirer.createPromptModule({ output: process.stderr });
  prompt.registerPrompt("autocomplete", inquirerPrompt);
  const { selected } = await prompt({
    type: "autocomplete",
    name: "selected",
    message: chalk.greenBright("Select a model to load") + chalk.gray(" |"),
    initialSearch,
    loop: false,
    pageSize: terminalSize().rows - leaveEmptyLines,
    emptyText: "No model matched the filter",
    source: async (_: any, input: string) => {
      const options = fuzzy.filter(input ?? "", modelPaths, {
        pre: "\x1b[91m",
        post: "\x1b[39m",
      });
      return options.map(option => {
        const model = models[option.index];
        const displayName =
          option.string + " " + chalk.gray(`(${formatSizeBytes1000(model.sizeBytes)})`);
        // if (lastLoadedMap.has(model.path)) {
        //   displayName = chalk.yellowBright("[Recent] ") + displayName;
        // }
        return {
          value: model,
          short: option.original,
          name: displayName,
        };
      });
    },
  } as any);
  return selected;
}

async function loadModel(
  logger: SimpleLogger,
  client: LMStudioClient,
  model: DownloadedModel,
  identifier: string | undefined,
  config: LLMLoadModelConfig,
) {
  const { path, sizeBytes } = model;
  logger.info(`Loading model "${path}"...`);
  logger.debug("Identifier:", identifier);
  logger.debug("Config:", config);
  const progressBar = new ProgressBar();
  const startTime = Date.now();
  const abortController = new AbortController();
  const sigintListener = () => {
    progressBar.stop();
    abortController.abort();
    logger.warn("Load cancelled.");
    process.exit(1);
  };
  process.addListener("SIGINT", sigintListener);
  const llmModel = await client.llm.load(path, {
    verbose: false,
    onProgress: progress => {
      progressBar.setRatio(progress);
    },
    signal: abortController.signal,
    noHup: true,
    config,
    identifier,
  });
  process.removeListener("SIGINT", sigintListener);
  const endTime = Date.now();
  progressBar.stop();
  logger.info(text`
    Model loaded successfully in ${formatElapsedTime(endTime - startTime)}.
    (${formatSizeBytes1000(sizeBytes)})
  `);
  const info = await llmModel.getModelInfo();
  logger.info(text`
    To use the model in the API/SDK, use the identifier "${chalk.greenBright(info!.identifier)}".
  `);
  if (identifier === undefined) {
    logger.info(text`
      To set a custom identifier, use the ${chalk.yellowBright("--identifier <identifier>")} option.
    `);
  }
}
