import { search } from "@inquirer/prompts";
import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import { type LLM, type LMStudioClient, type ModelInfo } from "@lmstudio/sdk";
import chalk from "chalk";
import fuzzy from "fuzzy";
import { formatSizeBytes1024 } from "../../formatBytes.js";
import { createDeviceNameResolver } from "../../deviceNameLookup.js";
import { fuzzyHighlightOptions, searchTheme } from "../../inquirerTheme.js";
import { runPromptWithExitHandling } from "../../prompt.js";
import { Spinner } from "../../Spinner.js";
import { UserInputError } from "../../types/UserInputError.js";
import { getOwnerNameFromModelName } from "../chat/util.js";
import { downloadArtifact } from "../get.js";

export interface ResolveModelForLaunchOpts {
  model?: string;
  contextLength?: number;
  yes: boolean;
  /**
   * When true, route model-load progress to stderr so `--print-env` stdout stays a clean,
   * eval-able shell script -- the Spinner otherwise writes progress + cursor escapes to stdout,
   * which `eval "$(lms launch ... --print-env)"` would ingest before the export/command lines.
   */
  printEnv?: boolean;
}

export interface ResolvedModel {
  identifier: string;
  contextLength?: number;
}

async function pickModelInteractively(
  client: LMStudioClient,
  logger: SimpleLogger,
): Promise<ModelInfo> {
  const deviceNameResolver = await createDeviceNameResolver(client, logger);
  // Only LLMs are launchable here (the launch path loads via `client.llm.load`). Excluding
  // non-LLM types keeps embedding/CLIP models out of the picker instead of letting the user
  // select one that then fails to load.
  const models = (await client.system.listDownloadedModels()).filter(
    model => model.type === "llm" && model.architecture?.toLowerCase().includes("clip") !== true,
  );
  if (models.length === 0) {
    throw new UserInputError(text`
      No downloaded LLMs found. Download one first with "lms get", then try again.
    `);
  }
  const modelKeys = models.map(model => model.modelKey);

  const pageSize = terminalSize().rows - 5;
  const picked = await runPromptWithExitHandling(() =>
    search<ModelInfo>(
      {
        message: chalk.green("Select a model to launch with") + chalk.dim(" |"),
        pageSize,
        theme: searchTheme,
        source: async (input: string | undefined, { signal }: { signal: AbortSignal }) => {
          void signal;
          const options = fuzzy.filter(input ?? "", modelKeys, fuzzyHighlightOptions);
          return options.map(option => {
            const model = models[option.index];
            const deviceSuffix = deviceNameResolver.isLocal(model.deviceIdentifier)
              ? ""
              : chalk.dim(` · ${deviceNameResolver.label(model.deviceIdentifier)}`);
            return {
              value: model,
              short: option.original,
              name:
                option.string + " " + chalk.dim(`(${formatSizeBytes1024(model.sizeBytes)})`) + deviceSuffix,
            };
          });
        },
      },
      { output: process.stderr },
    ),
  );
  // Return the full ModelInfo (not just modelKey): the caller needs the selected deviceIdentifier
  // so a device-specific pick (same key on multiple devices, or a non-local device) loads that
  // exact copy instead of letting the SDK fall back to its preferred/default device.
  return picked;
}

async function firstMatchingLoaded(
  loaded: LLM[],
  query: string,
  deviceIdentifier: string | null | undefined,
): Promise<LLM | undefined> {
  // When the user picked a specific device in the interactive picker, only reuse an instance that
  // is already loaded on that same device -- otherwise a same-key copy on another device would be
  // returned here (before the device-aware load runs) and we'd silently launch against a device the
  // user did not choose. deviceIdentifier is undefined for --model, preserving the prior matching.
  const onChosenDevice = async (model: LLM): Promise<boolean> =>
    deviceIdentifier === undefined ||
    (await model.getModelInfo()).deviceIdentifier === deviceIdentifier;

  const byIdentifier = loaded.find(model => model.identifier === query);
  if (byIdentifier !== undefined && (await onChosenDevice(byIdentifier))) {
    return byIdentifier;
  }
  for (const model of loaded) {
    const info = await model.getModelInfo();
    if (
      info.modelKey === query &&
      (deviceIdentifier === undefined || info.deviceIdentifier === deviceIdentifier)
    ) {
      return model;
    }
  }
  return undefined;
}

async function loadModelWithSpinner(
  client: LMStudioClient,
  logger: SimpleLogger,
  modelKey: string,
  contextLength: number | undefined,
  progressToStderr: boolean,
  deviceIdentifier: string | null | undefined,
): Promise<LLM> {
  const spinnerText = `Loading ${modelKey}`;
  const spinner = new Spinner(spinnerText, progressToStderr ? process.stderr : process.stdout);
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
    logger.warn("Load cancelled.");
    process.exit(1);
  };
  process.addListener("SIGINT", sigintListener);
  try {
    return await client.llm.load(modelKey, {
      verbose: false,
      signal: abortController.signal,
      config: { contextLength },
      // undefined lets the SDK pick its preferred device (the --model path); a value pins the
      // interactively-selected device so multi-device installs load the chosen copy.
      deviceIdentifier,
      onProgress: updateSpinnerProgress,
    });
  } finally {
    process.removeListener("SIGINT", sigintListener);
    spinner.stopIfNotStopped();
  }
}

async function useLoadedModel(
  existing: LLM,
  requestedContextLength: number | undefined,
  logger: SimpleLogger,
): Promise<ResolvedModel> {
  const actual = await existing.getContextLength();
  const info = await existing.getModelInfo();
  if (requestedContextLength !== undefined && requestedContextLength > actual) {
    logger.warnText`
      "${info.identifier}" is already loaded with a ${String(actual)}-token context, smaller than
      the requested ${String(requestedContextLength)}. Using the loaded instance as-is; run
      "lms unload ${info.identifier}" first to reload at a larger context.
    `;
  }
  return { identifier: info.identifier, contextLength: actual };
}

/**
 * Resolves the model to launch with: reuses an already-loaded instance, loads/JIT-downloads one,
 * or prompts interactively -- then always reads the *real* context length back from the loaded
 * model, so per-tool auto-compaction hints are accurate even when `-c` was omitted.
 */
export async function resolveModelForLaunch(
  client: LMStudioClient,
  logger: SimpleLogger,
  opts: ResolveModelForLaunchOpts,
): Promise<ResolvedModel> {
  let modelQuery = opts.model;
  // Only set when the user picks interactively: the device the selected entry lives on. Left
  // undefined for --model, where the SDK resolves the device itself.
  let deviceIdentifier: string | null | undefined;

  if (modelQuery === undefined || modelQuery === "") {
    const loaded = await client.llm.listLoaded();
    if (loaded.length === 1) {
      return await useLoadedModel(loaded[0], opts.contextLength, logger);
    }
    if (opts.yes) {
      throw new UserInputError(text`
        No model specified and ${loaded.length === 0 ? "no models are" : "more than one model is"}
        loaded. Pass --model, e.g. "lms launch <tool> --model owner/name".
      `);
    }
    const picked = await pickModelInteractively(client, logger);
    modelQuery = picked.modelKey;
    deviceIdentifier = picked.deviceIdentifier;
  }

  const loaded = await client.llm.listLoaded();
  const existing = await firstMatchingLoaded(loaded, modelQuery, deviceIdentifier);
  if (existing !== undefined) {
    return await useLoadedModel(existing, opts.contextLength, logger);
  }

  let model: LLM;
  try {
    model = await loadModelWithSpinner(
      client,
      logger,
      modelQuery,
      opts.contextLength,
      opts.printEnv === true,
      deviceIdentifier,
    );
  } catch (loadError) {
    const ownerName = getOwnerNameFromModelName(modelQuery);
    if (ownerName === null) {
      throw new UserInputError(text`
        Model "${modelQuery}" not found. See downloaded models with "lms ls", or download it
        first with "lms get ${modelQuery}".
      `);
    }
    // A load failure does not by itself mean the model is missing. If the artifact is already
    // downloaded (hub models are keyed by "owner/name"), the failure is real -- an invalid
    // requested context length, an unloadable model, or a server/runtime error -- and must be
    // surfaced. Otherwise the download path below hits its no-op branch and `process.exit(0)`s, so
    // `lms launch --model owner/name` would exit successfully without launching or reporting it.
    const alreadyDownloaded = (await client.system.listDownloadedModels()).some(
      downloaded => downloaded.modelKey === modelQuery,
    );
    if (alreadyDownloaded) {
      throw loadError;
    }
    // Genuinely missing. Under --print-env the command's stdout is consumed by
    // `eval "$(lms launch ... --print-env)"`, but the JIT downloader renders plan tables and
    // cursor escapes to stdout (and may prompt for confirmation), which would corrupt the emitted
    // shell script. Require the model to be present up front instead of downloading it here.
    if (opts.printEnv === true) {
      throw new UserInputError(text`
        Model "${modelQuery}" is not downloaded. Download it first with "lms get ${modelQuery}",
        then re-run with --print-env.
      `);
    }
    await downloadArtifact(client, logger, ownerName.owner, ownerName.name, opts.yes);
    // Retry via the config-aware loader (not the JIT `.model()` shortcut) so a requested
    // --context-length is still honored on a model that had to be downloaded first.
    model = await loadModelWithSpinner(
      client,
      logger,
      modelQuery,
      opts.contextLength,
      opts.printEnv === true,
      deviceIdentifier,
    );
  }

  const info = await model.getModelInfo();
  const contextLength = await model.getContextLength();
  return { identifier: info.identifier, contextLength };
}
