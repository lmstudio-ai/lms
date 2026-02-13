import { search } from "@inquirer/prompts";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import type { HubModel } from "@lmstudio/lms-shared-types";
import { type ModelInfo, type LLM, type LMStudioClient } from "@lmstudio/sdk";
import fuzzy from "fuzzy";
import { getCliPref } from "../../cliPref.js";
import { type DeviceNameResolver } from "../../deviceNameLookup.js";
import { runPromptWithExitHandling } from "../../prompt.js";
import { downloadArtifact } from "../get.js";
import { getCachedModelCatalogOrFetch } from "./catalogHelpers.js";
import { createModelDisplayOptions } from "./index.js";
import { getOwnerNameFromModelName, loadModelWithProgress } from "./util.js";

const MODEL_SELECTION_MESSAGE = "Select a model to chat with";

type ModelEntry = {
  name: string;
  modelKey: string;
  loadKey: string;
  isDownloaded: boolean;
  size: number;
  inModelCatalog: boolean;
  selectionKey: string;
  deviceName: string | null;
  deviceIdentifier: string | null;
};

const selectionKey = (key: string, deviceIdentifier: string | null) =>
  `${key}::${deviceIdentifier ?? ""}`;

export async function maybeGetLLM(
  client: LMStudioClient,
  modelKey: string | undefined,
  ttl: number,
  shouldFetchModelCatalog: boolean,
  logger: SimpleLogger,
  yes: boolean | undefined,
  deviceNameResolver: DeviceNameResolver,
): Promise<LLM | undefined> {
  const isModelRequested = modelKey !== undefined && modelKey !== "";
  const cliPref = await getCliPref(logger);

  try {
    return await tryLoadRequestedOrDefault(client, modelKey, ttl, logger);
  } catch {
    if (!process.stdin.isTTY) {
      exitNoTty(logger, isModelRequested, modelKey);
    }
  }

  if (isModelRequested) {
    const downloadedModel = await tryDownloadRequestedModel(client, modelKey!, ttl, logger, yes);
    if (downloadedModel !== null) {
      return downloadedModel;
    }
  } else {
    if (yes === true) {
      logger.error("No loaded model found, load with:\n       lms load");
      process.exit(1);
    }
    return undefined;
  }

  if (yes === true) {
    logger.errorText`
        Unable to download or load the requested model '${modelKey}'. Please check the model name
        and try downloading it first with 'lms get'.
      `;
    process.exit(1);
  }

  logger.error("Did not find the model. Please select a model to use:");

  const modelCatalogModels = await getModelCatalogModels(client, logger, shouldFetchModelCatalog);
  const lastLoadedModels = cliPref.get().lastLoadedModels ?? [];
  const downloadedModels = sortDownloadedModelsByLastLoaded(
    await client.system.listDownloadedModels(),
    lastLoadedModels,
  );
  const modelsMap = buildModelEntries(modelCatalogModels, downloadedModels, deviceNameResolver);
  const selectedModelKey = await promptForModelSelection(modelsMap, shouldFetchModelCatalog);
  const selectedModel = await resolveSelectedModel(
    modelsMap,
    selectedModelKey,
    client,
    logger,
    yes,
  );

  return loadModelWithProgress(client, selectedModel.loadKey, ttl, logger, {
    deviceIdentifier: selectedModel.deviceIdentifier,
    deviceName: deviceNameResolver.label(selectedModel.deviceIdentifier),
  });
}

function exitNoTty(logger: SimpleLogger, isModelRequested: boolean, modelKey: string | undefined) {
  if (isModelRequested !== true) {
    logger.error("No loaded model found, load with:\n       lms load");
  } else {
    logger.error(`Model "${modelKey}" not found, load with:\n       lms load ${modelKey}`);
  }
  process.exit(1);
}

async function tryLoadRequestedOrDefault(
  client: LMStudioClient,
  modelKey: string | undefined,
  ttl: number,
  logger: SimpleLogger,
): Promise<LLM> {
  if (modelKey !== undefined && modelKey !== "") {
    return loadModelWithProgress(client, modelKey, ttl, logger);
  }
  return client.llm.model();
}

async function tryDownloadRequestedModel(
  client: LMStudioClient,
  modelKey: string,
  ttl: number,
  logger: SimpleLogger,
  yes: boolean | undefined,
): Promise<LLM | null> {
  const getOwnerNameResult = getOwnerNameFromModelName(modelKey);
  if (getOwnerNameResult === null) {
    logger.errorText`
      Invalid model name '${modelKey}'. Please provide a model name in the format
      'owner/model-name'.
    `;
    process.exit(1);
  }

  const { owner, name } = getOwnerNameResult;
  try {
    await downloadArtifact(client, logger, owner, name, yes ?? false);
    // Downloads are always local for now; force loading on local device.
    // TODO: Change this when we have remote downloads supported
    return await loadModelWithProgress(client, modelKey, ttl, logger, {
      deviceIdentifier: null,
    });
  } catch {
    return null;
  }
}

async function getModelCatalogModels(
  client: LMStudioClient,
  logger: SimpleLogger,
  shouldFetchModelCatalog: boolean,
): Promise<HubModel[]> {
  if (!shouldFetchModelCatalog) {
    return [];
  }
  return await getCachedModelCatalogOrFetch(client, logger);
}

function sortDownloadedModelsByLastLoaded(
  models: ModelInfo[],
  lastLoadedModels: string[],
): ModelInfo[] {
  const lastLoadedIndexToPathMap = [...lastLoadedModels.entries()];
  const lastLoadedMap = new Map(lastLoadedIndexToPathMap.map(([index, path]) => [path, index]));
  return models
    .filter(model => model.architecture?.toLowerCase().includes("clip") !== true)
    .sort((a, b) => {
      const aIndex = lastLoadedMap.get(a.path) ?? lastLoadedMap.size + 1;
      const bIndex = lastLoadedMap.get(b.path) ?? lastLoadedMap.size + 1;
      return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0;
    });
}

function buildModelEntries(
  modelCatalogModels: HubModel[],
  downloadedModels: ModelInfo[],
  deviceNameResolver: DeviceNameResolver,
): ModelEntry[] {
  const downloadedModelKeys = new Set(downloadedModels.map(model => model.modelKey));

  const catalogEntries: ModelEntry[] = modelCatalogModels
    .filter(m => !downloadedModelKeys.has(m.owner + "/" + m.name))
    .map(m => {
      const modelKey = m.owner + "/" + m.name;
      return {
        name: modelKey,
        modelKey,
        loadKey: modelKey,
        isDownloaded: false,
        size: m.metadata.minMemoryUsageBytes,
        inModelCatalog: true,
        selectionKey: selectionKey(modelKey, null),
        deviceName: null,
        deviceIdentifier: null,
      };
    });

  const downloadedEntries: ModelEntry[] = downloadedModels.map(model => ({
    name: model.displayName,
    modelKey: model.modelKey,
    loadKey: model.path ?? model.modelKey,
    isDownloaded: true,
    size: model.sizeBytes,
    inModelCatalog: false,
    selectionKey: selectionKey(model.path ?? model.modelKey, model.deviceIdentifier),
    deviceName: deviceNameResolver.label(model.deviceIdentifier),
    deviceIdentifier: model.deviceIdentifier,
  }));

  return [...catalogEntries, ...downloadedEntries];
}

async function promptForModelSelection(
  modelsMap: ModelEntry[],
  shouldFetchModelCatalog: boolean,
): Promise<string> {
  const displayOptions = createModelDisplayOptions(modelsMap, !shouldFetchModelCatalog);
  return runPromptWithExitHandling(() =>
    search<string>(
      {
        message: MODEL_SELECTION_MESSAGE,
        pageSize: terminalSize().rows - 4,
        source: async (inputValue: string | undefined, { signal }: { signal: AbortSignal }) => {
          void signal;
          if (inputValue === undefined || inputValue.length === 0) {
            return displayOptions;
          }
          const options = fuzzy.filter(inputValue, displayOptions, {
            extract: option => option.searchText,
          });
          return options.map(option => option.original);
        },
      },
      { output: process.stderr },
    ),
  );
}

async function resolveSelectedModel(
  modelsMap: ModelEntry[],
  selectedModelKey: string,
  client: LMStudioClient,
  logger: SimpleLogger,
  yes: boolean | undefined,
): Promise<ModelEntry> {
  const selectedModel = modelsMap.find(modelEntry => modelEntry.selectionKey === selectedModelKey);

  if (selectedModel === undefined) {
    logger.error("No model selected, exiting.");
    process.exit(1);
  }
  if (!selectedModel.isDownloaded) {
    if (selectedModel.inModelCatalog) {
      const [owner, name] = selectedModel.name.split("/");
      await downloadArtifact(client, logger, owner, name, yes ?? false);
      return selectedModel;
    }
    // It is not a model from the catalog, so must be a direct model which is not downloaded,
    // unexpected path as only cataloged models are offered to download
    logger.errorText`
        Model ${selectedModel.name} is not downloaded. Please download the model first with
        'lms get'.
      `;
    process.exit(1);
  }

  return selectedModel;
}
