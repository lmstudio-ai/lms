import {
  Command,
  InvalidArgumentError,
  Option,
  type OptionValues,
} from "@commander-js/extra-typings";
import { search } from "@inquirer/prompts";
import { makeTitledPrettyError, type SimpleLogger, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import { type ModelInfo } from "@lmstudio/lms-shared-types";
import {
  type EstimatedResourcesUsage,
  type LLMLoadModelConfig,
  type LMStudioClient,
} from "@lmstudio/sdk";
import chalk from "chalk";
import fuzzy from "fuzzy";
import { getCliPref } from "../cliPref.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { formatElapsedTime } from "../formatElapsedTime.js";
import { formatSizeBytes1000, formatSizeBytes1024 } from "../formatBytes.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { runPromptWithExitHandling } from "../prompt.js";
import { Spinner } from "../Spinner.js";
import { createRefinedNumberParser } from "../types/refinedNumber.js";
import { fuzzyHighlightOptions, searchTheme } from "../inquirerTheme.js";

const gpuOptionParser = (str: string): number => {
  str = str.trim().toLowerCase();
  if (str === "off") {
    return 0;
  } else if (str === "max") {
    return 1;
  }
  const num = +str;
  if (Number.isNaN(num)) {
    throw new InvalidArgumentError("Not a number");
  }
  if (num < 0 || num > 1) {
    throw new InvalidArgumentError("Number out of range, must be between 0 and 1");
  }
  return num;
};

type LoadCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    ttl?: number;
    gpu?: number;
    contextLength?: number;
    parallel?: number;
    exact?: boolean;
    identifier?: string;
    yes?: boolean;
    estimateOnly?: boolean;
  };

const loadCommand = new Command<[], LoadCommandOptions>()
  .name("load")
  .description("Load a model")
  .argument(
    "[path]",
    text`
      The path of the model to load. If not provided, enters an interactive mode to select a model.
    `,
  )
  .addOption(
    new Option(
      "--gpu <offload-ratio>",
      text`
        GPU offload ratio. Valid values: "off" (disable GPU), "max" (full offload), or a number
        between 0 and 1 (e.g., "0.5" for 50% offload). By default, LM Studio automatically
        determines the optimal offload ratio.
      `,
    ).argParser(gpuOptionParser),
  )
  .addOption(
    new Option(
      "-c, --context-length <length>",
      text`
        The number of tokens to consider as context when generating text. If not provided, the
        default value will be used.
      `,
    ).argParser(createRefinedNumberParser({ integer: true, min: 1 })),
  )
  .addOption(
    new Option(
      "--parallel <count>",
      text`
        Maximum number of predictions the model can run at a given time. The speed of each
        individual prediction may decrease with concurrency, but each prediction will start faster
        and higher total throughput can be achieved.
      `,
    ).argParser(createRefinedNumberParser({ integer: true, min: 1 })),
  )
  .addOption(
    new Option(
      "--ttl <seconds>",
      text`
        TTL: If provided, when the model is not used for this number of seconds, it will be unloaded.
      `,
    ).argParser(createRefinedNumberParser({ integer: true, min: 1 })),
  )
  .option(
    "--exact",
    text`
      Only load the model if the path provided matches the model exactly. Fails if the path
      provided does not match any model.
    `,
  )
  .option(
    "--identifier <identifier>",
    text`
      The identifier to assign to the loaded model. The identifier can be used to refer to the
      model in the API.
    `,
  )
  .option(
    "--estimate-only",
    text`
      Calculate an estimate of the resources required to load the model. Does not load the model.
    `,
  )
  .option(
    "-y, --yes",
    text`
      Automatically approve all prompts. Useful for scripting. If there are multiple
      models matching the path, the first one will be loaded. Fails if the path provided does not
      match any model.
    `,
  );

addCreateClientOptions(loadCommand);
addLogLevelOptions(loadCommand);

loadCommand.action(async (pathArg, options: LoadCommandOptions) => {
  const {
    ttl: ttlSeconds,
    gpu,
    contextLength,
    parallel: maxParallelPredictions,
    yes = false,
    exact = false,
    identifier,
    estimateOnly,
  } = options;
  const loadConfig: LLMLoadModelConfig = {
    contextLength,
    maxParallelPredictions,
  };
  if (gpu !== undefined) {
    loadConfig.gpu = {
      ratio: gpu,
    };
  }
  let path = pathArg;
  const logger = createLogger(options);
  await using client = await createClient(logger, options);
  const cliPref = await getCliPref(logger);

  const lastLoadedModels = cliPref.get().lastLoadedModels ?? [];
  const lastLoadedIndexToPathMap = [...lastLoadedModels.entries()];
  const lastLoadedMap = new Map(lastLoadedIndexToPathMap.map(([index, path]) => [path, index]));
  logger.debug(`Last loaded map loaded with ${lastLoadedMap.size} models.`);

  const models = (await client.system.listDownloadedModels())
    .filter(model => model.architecture?.toLowerCase().includes("clip") !== true)
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
            The parameter ${chalk.cyan("[path]")} is required when using the
            ${chalk.yellow("--exact")} flag.
          `,
        ).message,
      );
      process.exit(1);
    }
    if (model === undefined) {
      if (models.length === 0) {
        logger.errorWithoutPrefix(
          makeTitledPrettyError(
            "Model not found",
            text`
              No model found with path being exactly "${chalk.yellow(path)}".

              To disable exact matching, remove the ${chalk.yellow("--exact")} flag.

              To see a list of all downloaded models, run:

                  ${chalk.yellow("lms ls")}
            `,
          ).message,
        );
      } else {
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
              No model found with path being exactly "${chalk.yellow(path)}".

              To disable exact matching, remove the ${chalk.yellow("--exact")} flag.

              To see a list of all downloaded models, run:

                  ${chalk.yellow("lms ls")}

              Note, you need to provide the full model path. For example:

                lms load --exact ${shortestName}
            `,
          ).message,
        );
      }
      process.exit(1);
    }

    if (estimateOnly === true) {
      const estimate = await (
        model.type === "llm" ? client.llm : client.embedding
      ).estimateResourcesUsage(model.modelKey, loadConfig);
      printEstimatedResourceUsage(model, loadConfig.contextLength, gpu, estimate, logger);
      return;
    }

    await loadModel(logger, client, model, identifier, loadConfig, ttlSeconds);
    return;
  }

  const modelPaths = models.map(model => model.path);

  const initialFilteredModels = fuzzy.filter(path ?? "", modelPaths);
  logger.debug("Initial filtered models length:", initialFilteredModels.length);

  let model: ModelInfo;
  if (yes) {
    if (initialFilteredModels.length === 0) {
      logger.errorWithoutPrefix(
        makeTitledPrettyError(
          "Model not found",
          text`
            No model found that matches path "${chalk.yellow(path)}".

            To see a list of all downloaded models, run:

                ${chalk.yellow("lms ls")}

            To select a model interactively, remove the ${chalk.yellow("--yes")} flag:

                lms load
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
      model = await selectModel(models, modelPaths, "", 4, lastLoadedMap, estimateOnly);
    } else if (initialFilteredModels.length === 0) {
      console.info(
        chalk.red(text`
          ! Cannot find a model matching the provided path (${chalk.yellow(path)}). Please
          select one from the list below.
        `),
      );
      path = "";
      model = await selectModel(models, modelPaths, path, 5, lastLoadedMap, estimateOnly);
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
      model = await selectModel(models, modelPaths, path ?? "", 5, lastLoadedMap, estimateOnly);
    }
  }

  if (estimateOnly === true) {
    const estimate = await (
      model.type === "llm" ? client.llm : client.embedding
    ).estimateResourcesUsage(model.modelKey, loadConfig);
    printEstimatedResourceUsage(model, loadConfig.contextLength, gpu, estimate, logger);
    return;
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

  await loadModel(logger, client, model, identifier, loadConfig, ttlSeconds);
});

async function selectModel(
  models: ModelInfo[],
  modelPaths: string[],
  initialSearch: string,
  leaveEmptyLines: number,
  _lastLoadedMap: Map<string, number>,
  estimateOnly: boolean = false,
) {
  const pageSize = terminalSize().rows - leaveEmptyLines;
  return await runPromptWithExitHandling(() =>
    search<ModelInfo>(
      {
        message:
          chalk.green(`Select a model to ${estimateOnly === true ? "estimate" : "load"}`) +
          chalk.dim(" |"),
        pageSize,
        theme: searchTheme,
        source: async (input: string | undefined, { signal }: { signal: AbortSignal }) => {
          void signal;
          const searchTerm = input ?? initialSearch;
          const options = fuzzy.filter(searchTerm, modelPaths, fuzzyHighlightOptions);
          return options.map(option => {
            const model = models[option.index];
            const displayName =
              option.string + " " + chalk.dim(`(${formatSizeBytes1000(model.sizeBytes)})`);
            return {
              value: model,
              short: option.original,
              name: displayName,
            };
          });
        },
      },
      { output: process.stderr },
    ),
  );
}

async function loadModel(
  logger: SimpleLogger,
  client: LMStudioClient,
  model: ModelInfo,
  identifier: string | undefined,
  config: LLMLoadModelConfig,
  ttlSeconds: number | undefined,
) {
  const { path, sizeBytes } = model;
  logger.debug("Identifier:", identifier);
  logger.debug("Config:", config);

  const spinner = new Spinner(`Loading ${path}`);
  const startTime = Date.now();
  const abortController = new AbortController();

  const sigintListener = () => {
    spinner.stop();
    abortController.abort();
    logger.warn("Load cancelled.");
    process.exit(1);
  };

  process.addListener("SIGINT", sigintListener);
  let llmModel;
  try {
    llmModel = await (model.type === "llm" ? client.llm : client.embedding).load(model.modelKey, {
      verbose: false,
      ttl: ttlSeconds,
      signal: abortController.signal,
      config,
      identifier,
    });
  } finally {
    process.removeListener("SIGINT", sigintListener);
    spinner.stopIfNotStopped();
  }
  const endTime = Date.now();
  logger.info(text`
    Model loaded successfully in ${formatElapsedTime(endTime - startTime)}.
    (${formatSizeBytes1000(sizeBytes)})
  `);
  const info = await llmModel.getModelInfo();
  logger.info(text`
    To use the model in the API/SDK, use the identifier "${chalk.green(info!.identifier)}".
  `);
}

function printEstimatedResourceUsage(
  model: ModelInfo,
  contextLength: number | undefined,
  gpuOffloadRatio: number | undefined,
  estimate: EstimatedResourcesUsage,
  logger: SimpleLogger,
) {
  const colorFunc = estimate.passesGuardrails === true ? chalk.green : chalk.yellow;
  logger.info(`Model: ${model.path}`);
  if (contextLength !== undefined) {
    logger.info(`Context Length: ${contextLength.toLocaleString()}`);
  }
  if (gpuOffloadRatio !== undefined) {
    logger.info(`GPU Offload: ${gpuOffloadRatio * 100}%`);
  }
  logger.info(
    `Estimated GPU Memory:   ${colorFunc(formatSizeBytes1024(estimate.memory.totalVramBytes))}`,
  );
  logger.info(
    `Estimated Total Memory: ${colorFunc(formatSizeBytes1024(estimate.memory.totalBytes))}`,
  );

  if (estimate.memory.confidence === "low") {
    logger.info(`Confidence: ${chalk.yellow(estimate.memory.confidence.toUpperCase())}`);
  }
  const message =
    estimate.passesGuardrails === true
      ? "This model may be loaded based on your resource guardrails settings."
      : "This model will fail to load based on your resource guardrails settings.";

  logger.info("\nEstimate: " + colorFunc(message));
}

export const load = loadCommand;
