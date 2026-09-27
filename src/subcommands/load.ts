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
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getCliPref } from "../cliPref.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { type DeviceNameResolver, createDeviceNameResolver } from "../deviceNameLookup.js";
import { formatElapsedTime } from "../formatElapsedTime.js";
import { formatSizeBytes1024 } from "../formatBytes.js";
import { t } from "../i18n/index.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { runPromptWithExitHandling } from "../prompt.js";
import { Spinner } from "../Spinner.js";
import { createRefinedNumberParser } from "../types/refinedNumber.js";
import { fuzzyHighlightOptions, searchTheme } from "../inquirerTheme.js";
import { resolveCliSpeculativeDecodingLoadConfig } from "./loadSpeculativeDecoding.js";

const gpuOptionParser = (str: string): number => {
  str = str.trim().toLowerCase();
  if (str === "off") {
    return 0;
  } else if (str === "max") {
    return 1;
  }
  const num = +str;
  if (Number.isNaN(num)) {
    throw new InvalidArgumentError(t("Not a number"));
  }
  if (num < 0 || num > 1) {
    throw new InvalidArgumentError(t("Number out of range, must be between 0 and 1"));
  }
  return num;
};

type LoadCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    ttl?: number;
    auto?: boolean;
    gpu?: number;
    contextLength?: number;
    parallel?: number;
    speculativeDraftMtp?: boolean;
    speculativeDraftSimple?: boolean;
    speculativeDraftModel?: string;
    speculativeDraftMaxTokens?: number;
    speculativeDraftMinTokens?: number;
    speculativeDraftMinContinueProbability?: number;
    exact?: boolean;
    local?: boolean;
    identifier?: string;
    yes?: boolean;
    estimateOnly?: boolean;
    engineConfigFile?: string | false;
    engineCwd?: string | false;
  };

interface AssertLoadConfigSupportedForCliModelOpts {
  model: Pick<ModelInfo, "type">;
  loadConfig: LLMLoadModelConfig;
  logger: SimpleLogger;
}

/** Rejects LLM-only load settings after the CLI resolves an embedding model. */
export function assertLoadConfigSupportedForCliModel({
  model,
  loadConfig,
  logger,
}: AssertLoadConfigSupportedForCliModelOpts): void {
  if (model.type !== "embedding") {
    return;
  }
  if (loadConfig.engineConfigFileContents !== undefined || loadConfig.engineCwd !== undefined) {
    logger.errorWithoutPrefix(
      makeTitledPrettyError(
        t("Unsupported load option"),
        t("Engine configuration options can only be configured for LLM models."),
      ).message,
    );
    process.exit(1);
  }
  if (loadConfig.autoFit === true) {
    logger.errorWithoutPrefix(
      makeTitledPrettyError(
        t("Unsupported load option"),
        t(text`
          AutoFit can only be configured for LLM models.
        `),
      ).message,
    );
    process.exit(1);
  }

  const hasSpeculativeDecodingLoadConfig =
    loadConfig.speculativeDraftMtp !== undefined ||
    loadConfig.speculativeDraftSimple !== undefined ||
    loadConfig.speculativeDraftModel !== undefined ||
    loadConfig.speculativeDraftMaxTokens !== undefined ||
    loadConfig.speculativeDraftMinTokens !== undefined ||
    loadConfig.speculativeDraftMinContinueProbability !== undefined;
  if (!hasSpeculativeDecodingLoadConfig) {
    return;
  }

  logger.errorWithoutPrefix(
    makeTitledPrettyError(
      t("Unsupported load option"),
      t(text`
        Speculative decoding can only be configured for LLM models.
      `),
    ).message,
  );
  process.exit(1);
}

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
  .description(t("Load a model"))
  .argument(
    "[model-key]",
    t(text`
      The model key to load. If not provided, enters an interactive mode to select a model.
    `),
  )
  .option(
    "--engine-config-file <path>",
    t(text`
      Import an engine configuration file. Use trusted files without secrets; contents are
      readable by users and clients with access to the model's configuration.
    `),
  )
  .option("--no-engine-config-file", t("Use ordinary LM Studio settings for this load."))
  .option(
    "--engine-cwd <path>",
    t(text`
      Set the engine's current working directory in config-file mode. Defaults to the saved
      directory or runtime temp, which is removed on unload.
    `),
  )
  .option("--no-engine-cwd", t("Use the runtime temporary directory for this load."))
  .addOption(
    new Option(
      "--auto",
      t(text`
        Automatically choose context length and model placement based on available resources,
        when supported by the connected backend.
      `),
    ).conflicts(["gpu", "contextLength"]),
  )
  .addOption(
    new Option(
      "--gpu <offload-ratio>",
      t(text`
        GPU offload ratio. Valid values: "off" (disable GPU), "max" (full offload), or a number
        between 0 and 1 (e.g., "0.5" for 50% offload). By default, LM Studio automatically
        determines the optimal offload ratio.
      `),
    ).argParser(gpuOptionParser),
  )
  .addOption(
    new Option(
      "-c, --context-length <length>",
      t(text`
        The number of tokens to consider as context when generating text. If not provided, the
        default value will be used.
      `),
    ).argParser(createRefinedNumberParser({ integer: true, min: 1 })),
  )
  .addOption(
    new Option(
      "--parallel <count>",
      t(text`
        Maximum number of predictions the model can run at a given time. The speed of each
        individual prediction may decrease with concurrency, but each prediction will start faster
        and higher total throughput can be achieved.
      `),
    ).argParser(createRefinedNumberParser({ integer: true, min: 1 })),
  )
  .addOption(
    new Option(
      "--ttl <seconds>",
      t(text`
        TTL: If provided, when the model is not used for this number of seconds, it will be unloaded.
      `),
    ).argParser(createRefinedNumberParser({ integer: true, min: 1 })),
  )
  .addOption(
    new Option(
      "--speculative-draft-mtp",
      t(text`
        Enable load-time Draft MTP speculative decoding when supported by the model.
      `),
    ).default(undefined),
  )
  .addOption(
    new Option(
      "--no-speculative-draft-mtp",
      t(text`
        Disable load-time Draft MTP speculative decoding.
      `),
    ).default(undefined),
  )
  .addOption(
    new Option(
      "--speculative-draft-simple",
      t(text`
        Enable load-time Draft Simple speculative decoding using --speculative-draft-model.
      `),
    ),
  )
  .addOption(
    new Option(
      "--speculative-draft-model <model>",
      t(text`
        Draft model resource to use with --speculative-draft-simple.
      `),
    ),
  )
  .addOption(
    new Option(
      "--speculative-draft-max-tokens <count>",
      t(text`
        Maximum number of draft tokens to generate per speculative decoding step. Requires
        --speculative-draft-simple or --speculative-draft-mtp.
      `),
    ).argParser(createRefinedNumberParser({ integer: true, min: 1 })),
  )
  .addOption(
    new Option(
      "--speculative-draft-min-tokens <count>",
      t(text`
        Minimum draft length to consider for speculative decoding. Requires
        --speculative-draft-simple or --speculative-draft-mtp.
      `),
    ).argParser(createRefinedNumberParser({ integer: true, min: 0 })),
  )
  .addOption(
    new Option(
      "--speculative-draft-min-continue-probability <probability>",
      t(text`
        Continue drafting while token probability is at or above this threshold. Requires
        --speculative-draft-simple or --speculative-draft-mtp.
      `),
    ).argParser(createRefinedNumberParser({ min: 0, max: 1 })),
  )
  .addOption(
    new Option(
      "--exact",
      t(text`
        Only load the model if the path provided matches the model exactly. Fails if the path
        provided does not match any model.
      `),
    ).hideHelp(),
  )
  .addOption(
    new Option(
      "--local",
      t(text`
        Only use models available locally. Models provided via LM Link will be ignored.
      `),
    ).hideHelp(),
  )
  .option(
    "--identifier <identifier>",
    t(text`
      The identifier to assign to the loaded model. The identifier can be used to refer to the
      model in the API.
    `),
  )
  .option(
    "--estimate-only",
    t(text`
      Calculate an estimate of the resources required to load the model. Does not load the model.
    `),
  )
  .option(
    "-y, --yes",
    t(text`
      Automatically approve all prompts. Useful for scripting. If there are multiple
      models matching the model key, the model will be loaded on the preferred device (if set),
      or the first matching model will be loaded.
    `),
  );

addCreateClientOptions(loadCommand);
addLogLevelOptions(loadCommand);

loadCommand.action(async (modelKeyArg, options: LoadCommandOptions) => {
  const {
    ttl: ttlSeconds,
    auto,
    gpu,
    contextLength,
    parallel: maxParallelPredictions,
    speculativeDraftMtp,
    speculativeDraftSimple,
    speculativeDraftModel,
    speculativeDraftMaxTokens,
    speculativeDraftMinTokens,
    speculativeDraftMinContinueProbability,
    yes = false,
    exact = false,
    local = false,
    identifier,
    estimateOnly = false,
    engineConfigFile,
    engineCwd,
  } = options;
  const loadConfig: LLMLoadModelConfig = {
    ...(engineConfigFile === undefined
      ? {}
      : {
          engineConfigFileContents:
            engineConfigFile === false ? "" : await readFile(resolve(engineConfigFile), "utf8"),
        }),
    engineCwd:
      engineCwd === false || engineCwd === ""
        ? ""
        : engineCwd === undefined
          ? undefined
          : resolve(engineCwd),
    autoFit: auto === true ? true : undefined,
    contextLength,
    maxParallelPredictions,
    ...resolveCliSpeculativeDecodingLoadConfig({
      speculativeDraftMtp,
      speculativeDraftSimple,
      speculativeDraftModel,
      speculativeDraftMaxTokens,
      speculativeDraftMinTokens,
      speculativeDraftMinContinueProbability,
    }),
  };
  if (typeof engineConfigFile === "string" && loadConfig.engineConfigFileContents === "") {
    throw new Error(
      t(
        "Engine configuration file is empty. Use --no-engine-config-file to disable config-file mode.",
      ),
    );
  }
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
          t("Path not provided"),
          t(
            text`
            The parameter {p0} is required when using the
            {p1} flag.
          `,
            { p0: chalk.cyan("[model-key]"), p1: chalk.yellow("--exact") },
          ),
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
            t("Model not found"),
            t(
              text`
              No model found with path being exactly "{p0}".

              To disable exact matching, remove the {p1} flag.

              To see a list of all downloaded models, run:

                  {p2}
            `,
              {
                p0: chalk.yellow(modelPath),
                p1: chalk.yellow("--exact"),
                p2: chalk.yellow("lms ls"),
              },
            ),
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
            t("Model not found"),
            t(
              text`
              No model found with path being exactly "{p0}".

              To disable exact matching, remove the {p1} flag.

              To see a list of all downloaded models, run:

                  {p2}

              Note, you need to provide the full model path. For example:

                lms load --exact {p3}
            `,
              {
                p0: chalk.yellow(modelPath),
                p1: chalk.yellow("--exact"),
                p2: chalk.yellow("lms ls"),
                p3: shortestPath,
              },
            ),
          ).message,
        );
      }
      process.exit(1);
    }
    if (estimateOnly === true) {
      assertLoadConfigSupportedForCliModel({ model, loadConfig, logger });
      const estimate = await (
        model.type === "llm" ? client.llm : client.embedding
      ).estimateResourcesUsage(model.modelKey, loadConfig, {
        deviceIdentifier: model.deviceIdentifier,
      });
      printEstimatedResourceUsage(model, loadConfig.contextLength, gpu, estimate, logger);
      return;
    }

    const loadNamespace = model.type === "embedding" ? client.embedding : client.llm;
    assertLoadConfigSupportedForCliModel({ model, loadConfig, logger });
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
          t("Model not found"),
          t(
            text`
            No model found that matches model key "{p0}".

            To see a list of all downloaded models, run:

                {p1}

            To select a model interactively, remove the {p2} flag:

                lms load
          `,
            { p0: chalk.yellow(modelKey), p1: chalk.yellow("lms ls"), p2: chalk.yellow("--yes") },
          ),
        ).message,
      );
      process.exit(1);
    }
    if (initialFilteredModels.length > 1) {
      const matchingModels = initialFilteredModels.map(option => models[option.index]);
      const hasSameDeviceDuplicates = hasDuplicatesOnSameDevice(matchingModels);
      if (hasSameDeviceDuplicates) {
        logger.warn(
          t(
            text`
          {p0} models match the provided model key on the same device. Loading the first one.
        `,
            { p0: initialFilteredModels.length },
          ),
        );
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
        chalk.red(
          t(
            text`
          ! Cannot find a model matching the provided model key ({p0}). Please
          select one from the list below.
        `,
            { p0: chalk.yellow(modelKey) },
          ),
        ),
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
          t(text`
            ! Multiple models match the provided model key. Please select one.
          `),
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

  assertLoadConfigSupportedForCliModel({ model, loadConfig, logger });
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
          chalk.green(
            t(`Select a model to {p0}`, {
              p0: t(estimateOnly === true ? "estimate" : "load"),
            }),
          ) + chalk.dim(" |"),
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
  let lastProgressUpdateTime = 0;
  const updateSpinnerProgress = (progress: number) => {
    const now = Date.now();
    if (progress < 1 && now - lastProgressUpdateTime < 100) {
      return;
    }
    spinner.setText(`${spinnerText} ${(progress * 100).toFixed(0)}%`);
    lastProgressUpdateTime = now;
  };

  const sigintListener = () => {
    spinner.stop();
    abortController.abort();
    logger.warn(t("Load cancelled."));
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
      onProgress: updateSpinnerProgress,
    });
  } finally {
    process.removeListener("SIGINT", sigintListener);
    spinner.stopIfNotStopped();
  }
  const endTime = Date.now();
  const info = await llmModel.getModelInfo();
  if (info?.type === "llm" && info.format === "torch_safetensors") {
    const loadedConfig = await llmModel.getLoadConfig();
    if (
      "engineConfigFileContents" in loadedConfig &&
      typeof loadedConfig.engineConfigFileContents === "string" &&
      loadedConfig.engineConfigFileContents !== ""
    ) {
      logger.info(t("Using a configuration file; LM Studio load-tuning settings are ignored."));
    }
  }
  const loadedDeviceIdentifier = info?.deviceIdentifier ?? null;
  const elapsed = formatElapsedTime(endTime - startTime);
  const successLine = deviceNameResolver.isLocal(loadedDeviceIdentifier)
    ? t("Model loaded successfully in {time}.", { time: elapsed })
    : t("Model loaded successfully on {device} in {time}.", {
        device: deviceNameResolver.label(loadedDeviceIdentifier),
        time: elapsed,
      });
  const sizeBytes = info?.sizeBytes;
  const sizeLine = sizeBytes === undefined ? "" : `\n(${formatSizeBytes1024(sizeBytes)})`;
  logger.info(
    t(
      text`
    {p0}{p1}
  `,
      { p0: successLine, p1: sizeLine },
    ),
  );
  logger.info(
    t(
      text`
    To use the model in the API/SDK, use the identifier "{p0}".
  `,
      { p0: chalk.green(info!.identifier) },
    ),
  );
}

function printEstimatedResourceUsage(
  model: ModelInfo,
  contextLength: number | undefined,
  gpuOffloadRatio: number | undefined,
  estimate: EstimatedResourcesUsage,
  logger: SimpleLogger,
) {
  const colorFunc = estimate.passesGuardrails === true ? chalk.green : chalk.yellow;
  logger.info(t("Model: {p0}", { p0: model.modelKey }));
  if (contextLength !== undefined) {
    logger.info(t(`Context Length: {p0}`, { p0: contextLength.toLocaleString() }));
  }
  if (gpuOffloadRatio !== undefined) {
    logger.info(t(`GPU Offload: {p0}%`, { p0: gpuOffloadRatio * 100 }));
  }
  logger.info(
    t(`Estimated GPU Memory:   {p0}`, {
      p0: colorFunc(formatSizeBytes1024(estimate.memory.totalVramBytes)),
    }),
  );
  logger.info(
    t(`Estimated Total Memory: {p0}`, {
      p0: colorFunc(formatSizeBytes1024(estimate.memory.totalBytes)),
    }),
  );

  if (estimate.memory.confidence === "low") {
    logger.info(
      t(`Confidence: {p0}`, { p0: chalk.yellow(estimate.memory.confidence.toUpperCase()) }),
    );
  }
  const message =
    estimate.passesGuardrails === true
      ? t("This model may be loaded based on your resource guardrails settings.")
      : t("This model will fail to load based on your resource guardrails settings.");

  logger.info(t("\nEstimate: ") + colorFunc(message));
}

export const load = loadCommand;
