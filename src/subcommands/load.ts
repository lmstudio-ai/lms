import {
  Command,
  InvalidArgumentError,
  Option,
  type OptionValues,
} from "@commander-js/extra-typings";
import { search } from "@inquirer/prompts";
import { makeTitledPrettyError, type SimpleLogger, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import {
  type EstimatedResourcesUsage,
  type LLMLoadModelConfig,
  type ModelInfo,
  type LMStudioClient,
} from "@lmstudio/sdk";
import chalk from "chalk";
import fuzzy from "fuzzy";
import { getCliPref } from "../cliPref.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { type DeviceNameResolver, createDeviceNameResolver } from "../deviceNameLookup.js";
import { formatElapsedTime } from "../formatElapsedTime.js";
import { formatSizeBytes1024 } from "../formatBytes.js";
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
    local?: boolean;
    identifier?: string;
    yes?: boolean;
    estimateOnly?: boolean;
  };

function hasDuplicatesOnSameDevice(models: Array<ModelInfo>): boolean {
  const deviceIdentifierCounts = new Map<string | null, number>();
  for (const model of models) {
    const deviceIdentifier = model.deviceIdentifier;
    const nextCount = (deviceIdentifierCounts.get(deviceIdentifier) ?? 0) + 1;
    if (nextCount > 1) {
      return true;
    }
    deviceIdentifierCounts.set(deviceIdentifier, nextCount);
  }
  return false;
}

function hasMultipleModelKeys(models: Array<ModelInfo>): boolean {
  const modelKeys = new Set(models.map(model => model.modelKey));
  return modelKeys.size > 1;
}

const loadCommand = new Command<[], LoadCommandOptions>()
  .name("load")
  .description("Load a model")
  .argument(
    "[model-key]",
    text`
      The model key to load. If not provided, enters an interactive mode to select a model.
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
  .addOption(
    new Option(
      "--exact",
      text`
        Only load the model if the path provided matches the model exactly. Fails if the path
        provided does not match any model.
      `,
    ).hideHelp(),
  )
  .option(
    "--local",
    text`
      Only use models available locally. Models provided via LM Link will be ignored.
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
      models matching the model key, the model will be loaded on the preferred device (if set),
      or the first matching model will be loaded.
    `,
  );

addCreateClientOptions(loadCommand);
addLogLevelOptions(loadCommand);

loadCommand.action(async (modelKeyArg, options: LoadCommandOptions) => {
  const {
    ttl: ttlSeconds,
    gpu,
    contextLength,
    parallel: maxParallelPredictions,
    yes = false,
    exact = false,
    local = false,
    identifier,
    estimateOnly = false,
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
  let modelKey = modelKeyArg;
  const logger = createLogger(options);
  await using client = await createClient(logger, options);
  const cliPref = await getCliPref(logger);
  const deviceNameResolver = await createDeviceNameResolver(client, logger);

  const lastLoadedModels = cliPref.get().lastLoadedModels ?? [];
  const lastLoadedIndexToModelKeyMap = [...lastLoadedModels.entries()];
  const lastLoadedMap = new Map(
    lastLoadedIndexToModelKeyMap.map(([index, modelKey]) => [modelKey, index]),
  );
  logger.debug(`Last loaded map loaded with ${lastLoadedMap.size} models.`);

  const models = (await client.system.listDownloadedModels())
    .filter(model => model.architecture?.toLowerCase().includes("clip") !== true)
    .filter(model => (local ? model.deviceIdentifier === null : true))
    .sort((a, b) => {
      const aIndex = lastLoadedMap.get(a.modelKey) ?? lastLoadedMap.size + 1;
      const bIndex = lastLoadedMap.get(b.modelKey) ?? lastLoadedMap.size + 1;
      return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0;
    });

  if (exact) {
    if (modelKey === undefined) {
      logger.errorWithoutPrefix(
        makeTitledPrettyError(
          "Path not provided",
          text`
            The parameter ${chalk.cyan("[model-key]")} is required when using the
            ${chalk.yellow("--exact")} flag.
          `,
        ).message,
      );
      process.exit(1);
    }
    // In this case, we expect a model path and not a model key
    const modelPath = modelKey;
    const model = models.find(model => model.path === modelPath);
    if (model === undefined) {
      if (models.length === 0) {
        logger.errorWithoutPrefix(
          makeTitledPrettyError(
            "Model not found",
            text`
              No model found with path being exactly "${chalk.yellow(modelPath)}".

              To disable exact matching, remove the ${chalk.yellow("--exact")} flag.

              To see a list of all downloaded models, run:

                  ${chalk.yellow("lms ls")}
            `,
          ).message,
        );
      } else {
        const shortestPath = models.reduce((shortest, model) => {
          if (model.path.length < shortest.length) {
            return model.path;
          }
          return shortest;
        }, models[0].path);
        logger.errorWithoutPrefix(
          makeTitledPrettyError(
            "Model not found",
            text`
              No model found with path being exactly "${chalk.yellow(modelPath)}".

              To disable exact matching, remove the ${chalk.yellow("--exact")} flag.

              To see a list of all downloaded models, run:

                  ${chalk.yellow("lms ls")}

              Note, you need to provide the full model path. For example:

                lms load --exact ${shortestPath}
            `,
          ).message,
        );
      }
      process.exit(1);
    }
    if (estimateOnly === true) {
      const estimate = await (
        model.type === "llm" ? client.llm : client.embedding
      ).estimateResourcesUsage(model.modelKey, loadConfig, {
        deviceIdentifier: model.deviceIdentifier,
      });
      printEstimatedResourceUsage(model, loadConfig.contextLength, gpu, estimate, logger);
      return;
    }

    const loadNamespace = model.type === "embedding" ? client.embedding : client.llm;
    await loadModel({
      logger,
      namespace: loadNamespace,
      modelKey: model.modelKey,
      deviceNameResolver,
      identifier,
      config: loadConfig,
      ttlSeconds,
      deviceIdentifier: model.deviceIdentifier,
    });
    return;
  }

  const modelKeys = models.map(model => model.modelKey);

  const initialFilteredModels = fuzzy.filter(modelKey ?? "", modelKeys);
  logger.debug("Initial filtered models length:", initialFilteredModels.length);

  let model: ModelInfo;
  let deferToPreferredDevice = false;
  if (yes) {
    if (initialFilteredModels.length === 0) {
      logger.errorWithoutPrefix(
        makeTitledPrettyError(
          "Model not found",
          text`
            No model found that matches model key "${chalk.yellow(modelKey)}".

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
      const matchingModels = initialFilteredModels.map(option => models[option.index]);
      const hasSameDeviceDuplicates = hasDuplicatesOnSameDevice(matchingModels);
      if (hasSameDeviceDuplicates) {
        logger.warnText`
          ${initialFilteredModels.length} models match the provided model key on the same device. Loading the first one.
        `;
        model = models[initialFilteredModels[0].index];
      } else {
        model = matchingModels[0];
        deferToPreferredDevice = true;
      }
    } else {
      model = models[initialFilteredModels[0].index];
    }
  } else {
    console.info();
    if (modelKey === undefined) {
      model = await selectModel({
        models,
        modelKeys,
        initialSearch: "",
        leaveEmptyLines: 4,
        estimateOnly,
        deviceNameResolver,
      });
    } else if (initialFilteredModels.length === 0) {
      console.info(
        chalk.red(text`
          ! Cannot find a model matching the provided model key (${chalk.yellow(modelKey)}). Please
          select one from the list below.
        `),
      );
      modelKey = "";
      model = await selectModel({
        models,
        modelKeys,
        initialSearch: modelKey,
        leaveEmptyLines: 5,
        estimateOnly,
        deviceNameResolver,
      });
    } else if (initialFilteredModels.length === 1) {
      model = models[initialFilteredModels[0].index];
      // console.info(
      //   text`
      //     ! Confirm model selection, or select a different model.
      //   `,
      // );
      // model = await selectModelToLoad(models, modelPaths, path ?? "", 5, lastLoadedMap);
    } else {
      const matchingModels = initialFilteredModels.map(option => models[option.index]);
      const hasMultipleKeys = hasMultipleModelKeys(matchingModels);
      const hasSameDeviceDuplicates = hasDuplicatesOnSameDevice(matchingModels);
      if (hasMultipleKeys || hasSameDeviceDuplicates) {
        console.info(
          text`
            ! Multiple models match the provided model key. Please select one.
          `,
        );
        model = await selectModel({
          models,
          modelKeys,
          initialSearch: modelKey ?? "",
          leaveEmptyLines: 5,
          estimateOnly,
          deviceNameResolver,
        });
      } else {
        model = matchingModels[0];
        deferToPreferredDevice = true;
      }
    }
  }

  if (estimateOnly === true) {
    const estimate = await (
      model.type === "llm" ? client.llm : client.embedding
    ).estimateResourcesUsage(model.modelKey, loadConfig, {
      deviceIdentifier: deferToPreferredDevice ? undefined : model.deviceIdentifier,
    });
    printEstimatedResourceUsage(model, loadConfig.contextLength, gpu, estimate, logger);
    return;
  }

  const modelInLastLoadedModelsIndex = lastLoadedModels.indexOf(model.modelKey);
  if (modelInLastLoadedModelsIndex !== -1) {
    logger.debug("Removing model from last loaded models:", model.modelKey);
    lastLoadedModels.splice(modelInLastLoadedModelsIndex, 1);
  }
  lastLoadedModels.unshift(model.modelKey);
  logger.debug("Updating cliPref");
  cliPref.setWithProducer(draft => {
    // Keep only the last 20 loaded models
    draft.lastLoadedModels = lastLoadedModels.slice(0, 20);
  });

  const loadNamespace = model.type === "embedding" ? client.embedding : client.llm;
  await loadModel({
    logger,
    namespace: loadNamespace,
    modelKey: model.modelKey,
    deviceNameResolver,
    identifier,
    config: loadConfig,
    ttlSeconds,
    deviceIdentifier: deferToPreferredDevice ? undefined : model.deviceIdentifier,
  });
});

interface SelectModelOpts {
  models: Array<ModelInfo>;
  modelKeys: Array<string>;
  initialSearch: string;
  leaveEmptyLines: number;
  estimateOnly: boolean;
  deviceNameResolver: DeviceNameResolver;
}

async function selectModel({
  models,
  modelKeys,
  initialSearch,
  leaveEmptyLines,
  estimateOnly,
  deviceNameResolver,
}: SelectModelOpts) {
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
          const options = fuzzy.filter(searchTerm, modelKeys, fuzzyHighlightOptions);
          return options.map(option => {
            const model = models[option.index];
            const deviceSuffix = deviceNameResolver.isLocal(model.deviceIdentifier)
              ? ""
              : chalk.dim(` · ${deviceNameResolver.label(model.deviceIdentifier)}`);
            const displayName =
              option.string +
              " " +
              chalk.dim(`(${formatSizeBytes1024(model.sizeBytes)})`) +
              deviceSuffix;
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

async function loadModel({
  logger,
  namespace,
  modelKey,
  deviceNameResolver,
  identifier,
  config,
  ttlSeconds,
  deviceIdentifier,
}: {
  logger: SimpleLogger;
  namespace: LMStudioClient["llm"] | LMStudioClient["embedding"];
  modelKey: string;
  deviceNameResolver: DeviceNameResolver;
  identifier: string | undefined;
  config: LLMLoadModelConfig;
  ttlSeconds: number | undefined;
  deviceIdentifier: string | null | undefined;
}) {
  logger.debug("Identifier:", identifier);
  logger.debug("Config:", config);

  let spinnerText = `Loading ${modelKey}`;
  // When deviceIdentifier is undefined, the SDK picks the preferred device (if any) or could
  // fallback on some other device. So we don't show any device info in that case.
  if (deviceIdentifier !== undefined && !deviceNameResolver.isLocal(deviceIdentifier)) {
    const deviceLabel = deviceNameResolver.label(deviceIdentifier);
    spinnerText += ` on ${deviceLabel}`;
  }
  const spinner = new Spinner(spinnerText);
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
    llmModel = await namespace.load(modelKey, {
      verbose: false,
      ttl: ttlSeconds,
      signal: abortController.signal,
      config,
      identifier,
      deviceIdentifier,
    });
  } finally {
    process.removeListener("SIGINT", sigintListener);
    spinner.stopIfNotStopped();
  }
  const endTime = Date.now();
  const info = await llmModel.getModelInfo();
  const loadedDeviceIdentifier = info?.deviceIdentifier ?? null;
  const successLine = deviceNameResolver.isLocal(loadedDeviceIdentifier)
    ? `Model loaded successfully in ${formatElapsedTime(endTime - startTime)}.`
    : `Model loaded successfully on ${deviceNameResolver.label(
        loadedDeviceIdentifier,
      )} in ${formatElapsedTime(endTime - startTime)}.`;
  const sizeBytes = info?.sizeBytes;
  const sizeLine = sizeBytes === undefined ? "" : `\n(${formatSizeBytes1024(sizeBytes)})`;
  logger.info(text`
    ${successLine}${sizeLine}
  `);
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
  logger.info(`Model: ${model.modelKey}`);
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
