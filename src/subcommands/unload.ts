import { Command, type OptionValues } from "@commander-js/extra-typings";
import { search } from "@inquirer/prompts";
import { makeTitledPrettyError, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import { type EmbeddingModel, type LLM, type ModelInstanceInfo } from "@lmstudio/sdk";
import chalk from "chalk";
import fuzzy from "fuzzy";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { createDeviceNameResolver } from "../deviceNameLookup.js";
import { fuzzyHighlightOptions, searchTheme } from "../inquirerTheme.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { runPromptWithExitHandling } from "../prompt.js";

type UnloadCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    all?: boolean;
  };

const unloadCommand = new Command<[], UnloadCommandOptions>()
  .name("unload")
  .description("Unload a model")
  .argument(
    "[identifier]",
    text`
      The identifier of the model to unload. If not provided and exactly one model is loaded, it
      will be unloaded automatically. Otherwise, you will be prompted to select a model
      interactively from a list.
    `,
  )
  .option("-a, --all", "Unload all models");

addCreateClientOptions(unloadCommand);
addLogLevelOptions(unloadCommand);

unloadCommand.action(async (identifier, options: UnloadCommandOptions) => {
  const unloadAll = options.all === true;
  const logger = createLogger(options);
  await using client = await createClient(logger, options);
  const deviceNameResolver = await createDeviceNameResolver(client, logger);

  if (unloadAll === true && identifier !== undefined) {
    logger.errorWithoutPrefix(
      makeTitledPrettyError(
        "Invalid Usage",
        text`
          You cannot provide ${chalk.cyan("[path]")} when the flag
          ${chalk.yellow("--all")} is set.
        `,
      ).message,
    );
    return;
  }

  const models: Array<LLM | EmbeddingModel> = (
    await Promise.all([client.llm.listLoaded(), client.embedding.listLoaded()])
  ).flat();

  const modelInfoEntries = await Promise.all(
    models.map(async modelEntry => {
      const modelInfo = await modelEntry.getModelInfo();
      return [modelEntry, modelInfo] as const;
    }),
  );
  const modelInfoByModel = new Map<LLM | EmbeddingModel, ModelInstanceInfo>(modelInfoEntries);

  const getDeviceIdentifier = (modelEntry: LLM | EmbeddingModel): string | null => {
    const modelInfo = modelInfoByModel.get(modelEntry);
    if (modelInfo === undefined) {
      return null;
    }
    return modelInfo.deviceIdentifier ?? null;
  };

  const getDeviceSuffix = (modelEntry: LLM | EmbeddingModel): string => {
    const deviceIdentifier = getDeviceIdentifier(modelEntry);
    if (deviceNameResolver.isLocal(deviceIdentifier)) {
      return "";
    }
    return ` · ${deviceNameResolver.label(deviceIdentifier)}`;
  };

  const getPathSuffix = (modelEntry: LLM | EmbeddingModel): string => {
    if (modelEntry.identifier === modelEntry.path) {
      return "";
    }
    if (modelEntry.identifier.startsWith(modelEntry.path + ":")) {
      return "";
    }
    return ` (${modelEntry.path})`;
  };

  const formatModelTarget = (modelEntry: LLM | EmbeddingModel): string => {
    const deviceIdentifier = getDeviceIdentifier(modelEntry);
    if (deviceNameResolver.isLocal(deviceIdentifier)) {
      return `"${modelEntry.identifier}"`;
    }
    return `"${modelEntry.identifier}" on ${deviceNameResolver.label(deviceIdentifier)}`;
  };

  const searchDelimiter = "\u0001";

  const getModelSearchString = (modelEntry: LLM | EmbeddingModel): string => {
    const pathSuffix = getPathSuffix(modelEntry);
    const deviceSuffix = getDeviceSuffix(modelEntry);
    const suffix = `${pathSuffix}${deviceSuffix}`;
    return `${modelEntry.identifier}${searchDelimiter}${suffix}`;
  };

  const modelSearchStrings = models.map(modelEntry => getModelSearchString(modelEntry));

  const getDisplayNameFromRendered = (rendered: string): string => {
    const [identifierPart, suffixPart] = rendered.split(searchDelimiter);
    if (suffixPart === undefined || suffixPart.length === 0) {
      return identifierPart;
    }
    return `${identifierPart}${chalk.dim(suffixPart)}`;
  };

  const promptForModel = async (
    promptLabel: string,
    modelEntries: Array<LLM | EmbeddingModel>,
    searchStrings: Array<string>,
  ): Promise<LLM | EmbeddingModel> => {
    const pageSize = terminalSize().rows - 5;
    return await runPromptWithExitHandling(() =>
      search<(typeof modelEntries)[number]>(
        {
          message: chalk.green(promptLabel) + chalk.dim(" |"),
          pageSize,
          theme: searchTheme,
          source: async (input: string | undefined, { signal }: { signal: AbortSignal }) => {
            void signal;
            const searchTerm = input ?? "";
            const options = fuzzy.filter(searchTerm, searchStrings, fuzzyHighlightOptions);
            return options.map(option => {
              const modelEntry = modelEntries[option.index];
              if (modelEntry === undefined) {
                throw new Error("Search results returned an invalid model index.");
              }
              return {
                value: modelEntry,
                short: modelEntry.identifier,
                name: getDisplayNameFromRendered(option.string),
              };
            });
          },
        },
        { output: process.stderr },
      ),
    );
  };

  if (unloadAll === true) {
    if (models.length === 0) {
      logger.info("No models to unload.");
    } else {
      logger.debug(`Unloading ${models.length} models...`);
      for (const model of models) {
        logger.info(`Unloading ${formatModelTarget(model)}...`);
        await model.unload();
      }
      if (models.length > 1) {
        logger.info(`Unloaded ${models.length} models.`);
      } else {
        logger.info(`Unloaded 1 model.`);
      }
    }
  } else if (identifier !== undefined) {
    const matchingModels = models.filter(modelEntry => modelEntry.identifier === identifier);
    if (matchingModels.length === 0) {
      logger.errorWithoutPrefix(
        makeTitledPrettyError(
          "Model Not Found",
          text`
            Cannot find a model with the identifier "${chalk.yellow(identifier)}".

            To see a list of loaded models, run:

                ${chalk.yellow("lms ps")}
          `,
        ).message,
      );
      return;
    }
    if (matchingModels.length === 1) {
      const modelEntry = matchingModels[0];
      logger.debug(`Unloading ${formatModelTarget(modelEntry)}...`);
      await modelEntry.unload();
      logger.info(`Model ${formatModelTarget(modelEntry)} unloaded.`);
    } else {
      // Multiple models with the same identifier - prompt user to select
      const matchingSearchStrings = matchingModels.map(modelEntry =>
        getModelSearchString(modelEntry),
      );
      const selected = await promptForModel(
        "Multiple models found. Select one to unload",
        matchingModels,
        matchingSearchStrings,
      );
      logger.debug(`Unloading ${formatModelTarget(selected)}...`);
      await selected.unload();
      logger.info(`Model ${formatModelTarget(selected)} unloaded.`);
    }
  } else {
    if (models.length === 0) {
      logger.info(`You don't have any models loaded. Use "lms load" to load a model.`);
      process.exit(1);
    }
    // If there is exactly one model loaded, unload it automatically without prompting.
    if (models.length === 1) {
      const modelEntry = models[0];
      logger.debug(`Unloading ${formatModelTarget(modelEntry)}...`);
      await modelEntry.unload();
      logger.info(`Model ${formatModelTarget(modelEntry)} unloaded.`);
      return;
    }
    console.info(chalk.dim("! To unload all models, use the --all flag."));
    console.info();
    const selected = await promptForModel("Select a model to unload", models, modelSearchStrings);
    logger.debug(`Unloading ${formatModelTarget(selected)}...`);
    await selected.unload();
    logger.info(`Model ${formatModelTarget(selected)} unloaded.`);
  }
});

export const unload = unloadCommand;
