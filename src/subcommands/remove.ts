import { Command, type OptionValues } from "@commander-js/extra-typings";
import { search, select } from "@inquirer/prompts";
import { makeTitledPrettyError, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import { type EmbeddingModel, type LLM, type LMStudioClient, type ModelInfo } from "@lmstudio/sdk";
import chalk from "chalk";
import { readdir, rm, rmdir } from "fs/promises";
import fuzzy from "fuzzy";
import { dirname, isAbsolute, join, relative } from "path";
import { askQuestion } from "../confirm.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { createDeviceNameResolver, type DeviceNameResolver } from "../deviceNameLookup.js";
import { formatSizeBytes1000 } from "../formatBytes.js";
import { fuzzyHighlightOptions, searchTheme } from "../inquirerTheme.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { resolveModelsFolderPath } from "../modelsFolder.js";
import { runPromptWithExitHandling } from "../prompt.js";
import { printDownloadedModelsTable } from "./list.js";

type RemoveCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    yes?: boolean;
  };

const removeCommand = new Command<[], RemoveCommandOptions>()
  .name("remove")
  .alias("rm")
  .description("Remove a downloaded model from disk")
  .argument(
    "[modelKey]",
    text`
      The model key of the model to remove. If not provided, you will be prompted to select a model
      interactively from a list. Run ${chalk.yellow("lms ls")} to see your downloaded models.
    `,
  )
  .option(
    "-y, --yes",
    text`
      Skip the confirmation prompt. Deletion is permanent, so use this with caution.
    `,
  );

addCreateClientOptions(removeCommand);
addLogLevelOptions(removeCommand);

removeCommand.action(async (modelKey, options: RemoveCommandOptions) => {
  const logger = createLogger(options);
  const { yes = false } = options;

  // `lms remove` deletes files from the local models folder, so it can only operate on the local
  // LM Studio installation. If the user points the CLI at a remote instance via --host, the listed
  // models live on that machine while deletion would target local paths — refuse instead.
  if (options.host !== undefined) {
    logger.errorWithoutPrefix(
      makeTitledPrettyError(
        "Remote Removal Not Supported",
        text`
          ${chalk.yellow("lms remove")} deletes model files from the local models folder and cannot
          remove models from a remote LM Studio instance
          (${chalk.yellow(`--host ${options.host}`)}).

          Run ${chalk.yellow("lms remove")} directly on the machine where the model is stored.
        `,
      ).message,
    );
    process.exit(1);
  }

  await using client = await createClient(logger, options);
  const deviceNameResolver = await createDeviceNameResolver(client, logger);

  // Only models stored on this machine can be removed by deleting files. Remote models (available
  // via LM Link on another device) are filtered out.
  const downloadedModels = (await client.system.listDownloadedModels()).filter(model =>
    deviceNameResolver.isLocal(model.deviceIdentifier),
  );

  if (downloadedModels.length === 0) {
    logger.errorWithoutPrefix(
      makeTitledPrettyError(
        "No Models Found",
        text`
          You don't have any local models to remove. To download one, run:

              ${chalk.yellow("lms get <model>")}
        `,
      ).message,
    );
    process.exit(1);
  }

  // Resolve which downloaded model the user wants to remove.
  let baseModel: ModelInfo;
  if (modelKey !== undefined) {
    const matchingModels = downloadedModels.filter(model => model.modelKey === modelKey);
    if (matchingModels.length === 0) {
      logger.errorWithoutPrefix(
        makeTitledPrettyError(
          "Model Not Found",
          text`
            Cannot find a downloaded model with the key "${chalk.yellow(modelKey)}".

            To see a list of downloaded models, run:

                ${chalk.yellow("lms ls")}
          `,
        ).message,
      );
      process.exit(1);
    }
    baseModel = matchingModels[0];
  } else {
    baseModel = await promptForModel(downloadedModels);
  }

  // A model key can have multiple downloaded variants (e.g. different quantizations) that live in
  // the same folder. Let the user choose a single variant or the entire model.
  const target = await resolveRemovalTarget(client, baseModel);

  const modelsFolderPath = await resolveModelsFolderPath(logger, { ensureExists: false });
  const absolutePath = join(modelsFolderPath, target.path);

  // Refuse to delete a model whose files are currently loaded in memory.
  const blockingLoaded = await findLoadedModelsAtPath(
    client,
    deviceNameResolver,
    modelsFolderPath,
    absolutePath,
  );
  if (blockingLoaded.length > 0) {
    const identifiers = blockingLoaded
      .map(identifier => `    ${chalk.yellow(identifier)}`)
      .join("\n");
    logger.errorWithoutPrefix(
      makeTitledPrettyError(
        "Model In Use",
        text`
          This model is currently loaded and cannot be removed:

          ${identifiers}

          Unload it first, then try again:

              ${chalk.yellow("lms unload")}
        `,
      ).message,
    );
    process.exit(1);
  }

  // Show what will be removed using the same table format as `lms ls`.
  const title = target.type === "embedding" ? "EMBEDDING" : "LLM";
  console.info();
  console.info(chalk.yellow("The following model will be permanently removed:"));
  console.info();
  printDownloadedModelsTable(title, [target], [], deviceNameResolver);
  console.info();
  console.info(`${chalk.dim("Location:")} ${absolutePath}`);
  console.info();

  if (!yes) {
    const confirmed = await askQuestion(
      chalk.redBright(
        `Permanently delete this model (${formatSizeBytes1000(target.sizeBytes)})? This cannot be undone.`,
      ),
    );
    if (!confirmed) {
      logger.info("Aborted. No models were removed.");
      return;
    }
  }

  await rm(absolutePath, { recursive: true, force: true });
  await pruneEmptyParents(absolutePath, modelsFolderPath);

  logger.info(
    `Removed "${target.modelKey}", freeing ${formatSizeBytes1000(target.sizeBytes)} of disk space.`,
  );
});

/**
 * Prompt the user to interactively select a downloaded model from a fuzzy-searchable list.
 *
 * @param models - The downloaded models to choose from.
 * @returns A promise that resolves with the selected model.
 */
async function promptForModel(models: Array<ModelInfo>): Promise<ModelInfo> {
  // Used to split the model key from a dimmed, non-searchable description suffix.
  const searchDelimiter = "";
  const searchStrings = models.map(
    model =>
      `${model.modelKey}${searchDelimiter} ${formatSizeBytes1000(model.sizeBytes)} · ${model.type}`,
  );
  const pageSize = terminalSize().rows - 5;
  return await runPromptWithExitHandling(() =>
    search<ModelInfo>(
      {
        message: chalk.green("Select a model to remove") + chalk.dim(" |"),
        pageSize,
        theme: searchTheme,
        source: async (input: string | undefined, { signal }: { signal: AbortSignal }) => {
          void signal;
          const options = fuzzy.filter(input ?? "", searchStrings, fuzzyHighlightOptions);
          return options.map(option => {
            const model = models[option.index];
            if (model === undefined) {
              throw new Error("Search results returned an invalid model index.");
            }
            const [keyPart, suffixPart] = option.string.split(searchDelimiter);
            return {
              value: model,
              short: model.modelKey,
              name: suffixPart === undefined ? keyPart : `${keyPart}${chalk.dim(suffixPart)}`,
            };
          });
        },
      },
      { output: process.stderr },
    ),
  );
}

/**
 * Determine the exact target to remove. If the model has more than one downloaded variant, prompt
 * the user to either remove a single variant or the entire model.
 *
 * @param client - The LM Studio client.
 * @param baseModel - The model selected by the user.
 * @returns A promise that resolves with the ModelInfo to remove (either a single variant or the
 * base model representing all variants).
 */
async function resolveRemovalTarget(
  client: LMStudioClient,
  baseModel: ModelInfo,
): Promise<ModelInfo> {
  if (baseModel.variants === undefined || baseModel.variants.length <= 1) {
    return baseModel;
  }
  const variants = await client.system.listDownloadedModelVariants(baseModel.modelKey);
  if (variants.length <= 1) {
    return baseModel;
  }
  // `null` represents "remove the entire model" (i.e. the base model / whole folder).
  const selected = await runPromptWithExitHandling(() =>
    select<ModelInfo | null>(
      {
        message: chalk.green(
          `"${baseModel.modelKey}" has multiple variants. What do you want to remove?`,
        ),
        choices: [
          {
            name: text`
              All variants
              ${chalk.dim(`(entire model, ${formatSizeBytes1000(baseModel.sizeBytes)})`)}
            `,
            value: null,
          },
          ...variants.map(variant => ({
            name: `${variant.modelKey} ${chalk.dim(`(${formatSizeBytes1000(variant.sizeBytes)})`)}`,
            value: variant,
          })),
        ],
      },
      { output: process.stderr },
    ),
  );
  return selected ?? baseModel;
}

/**
 * Find any currently-loaded models whose files live at (or inside) the given path. Used to prevent
 * removing a model that is in use. Models loaded on remote devices (via LM Link) are ignored, since
 * deleting local files does not affect them.
 *
 * @param client - The LM Studio client.
 * @param deviceNameResolver - Resolver used to tell local models apart from remote ones.
 * @param modelsFolderPath - The absolute path to the models folder.
 * @param absolutePath - The absolute path that is about to be removed.
 * @returns A promise that resolves with the identifiers of the blocking loaded models.
 */
async function findLoadedModelsAtPath(
  client: LMStudioClient,
  deviceNameResolver: DeviceNameResolver,
  modelsFolderPath: string,
  absolutePath: string,
): Promise<Array<string>> {
  const loadedModels: Array<LLM | EmbeddingModel> = (
    await Promise.all([client.llm.listLoaded(), client.embedding.listLoaded()])
  ).flat();
  const blockingIdentifiers = await Promise.all(
    loadedModels.map(async model => {
      const modelInfo = await model.getModelInfo();
      // Only a model loaded on this machine can block deleting the local files.
      if (!deviceNameResolver.isLocal(modelInfo.deviceIdentifier ?? null)) {
        return null;
      }
      if (pathIsAtOrInside(absolutePath, join(modelsFolderPath, model.path))) {
        return model.identifier;
      }
      return null;
    }),
  );
  return blockingIdentifiers.filter((identifier): identifier is string => identifier !== null);
}

/**
 * Remove now-empty parent directories left behind after deleting a model, walking up towards (but
 * never removing) the models folder itself. This avoids leaving empty publisher/repo folders.
 *
 * @param absolutePath - The absolute path that was removed.
 * @param modelsFolderPath - The absolute path to the models folder (the boundary to stop at).
 */
async function pruneEmptyParents(absolutePath: string, modelsFolderPath: string): Promise<void> {
  let directory = dirname(absolutePath);
  while (pathIsAtOrInside(modelsFolderPath, directory) && directory !== modelsFolderPath) {
    let entries: Array<string>;
    try {
      entries = await readdir(directory);
    } catch {
      break;
    }
    if (entries.length > 0) {
      break;
    }
    try {
      await rmdir(directory);
    } catch {
      break;
    }
    directory = dirname(directory);
  }
}

/**
 * Determine whether `childPath` is equal to or nested inside `parentPath`. Comparison is done on
 * path segments so that, for example, "/models/ab" is not considered inside "/models/a".
 *
 * @param parentPath - The candidate parent (outer) path.
 * @param childPath - The candidate child (inner) path.
 * @returns `true` if `childPath` is `parentPath` or is contained within it.
 */
export function pathIsAtOrInside(parentPath: string, childPath: string): boolean {
  if (parentPath === childPath) {
    return true;
  }
  const relativePath = relative(parentPath, childPath);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

export const remove = removeCommand;
