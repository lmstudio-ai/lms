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
}

export interface ResolvedModel {
  identifier: string;
  contextLength?: number;
}

async function pickModelInteractively(
  client: LMStudioClient,
  logger: SimpleLogger,
): Promise<string> {
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
  return picked.modelKey;
}

async function firstMatchingLoaded(loaded: LLM[], query: string): Promise<LLM | undefined> {
  const byIdentifier = loaded.find(model => model.identifier === query);
  if (byIdentifier !== undefined) {
    return byIdentifier;
  }
  for (const model of loaded) {
    const info = await model.getModelInfo();
    if (info.modelKey === query) {
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
): Promise<LLM> {
  const spinnerText = `Loading ${modelKey}`;
  const spinner = new Spinner(spinnerText);
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
    modelQuery = await pickModelInteractively(client, logger);
  }

  const loaded = await client.llm.listLoaded();
  const existing = await firstMatchingLoaded(loaded, modelQuery);
  if (existing !== undefined) {
    return await useLoadedModel(existing, opts.contextLength, logger);
  }

  let model: LLM;
  try {
    model = await loadModelWithSpinner(client, logger, modelQuery, opts.contextLength);
  } catch {
    const ownerName = getOwnerNameFromModelName(modelQuery);
    if (ownerName === null) {
      throw new UserInputError(text`
        Model "${modelQuery}" not found. See downloaded models with "lms ls", or download it
        first with "lms get ${modelQuery}".
      `);
    }
    await downloadArtifact(client, logger, ownerName.owner, ownerName.name, opts.yes);
    // Retry via the config-aware loader (not the JIT `.model()` shortcut) so a requested
    // --context-length is still honored on a model that had to be downloaded first.
    model = await loadModelWithSpinner(client, logger, modelQuery, opts.contextLength);
  }

  const info = await model.getModelInfo();
  const contextLength = await model.getContextLength();
  return { identifier: info.identifier, contextLength };
}
