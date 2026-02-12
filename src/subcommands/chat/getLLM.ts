import { search } from "@inquirer/prompts";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import type { HubModel } from "@lmstudio/lms-shared-types";
import { type LLM, type LMStudioClient } from "@lmstudio/sdk";
import fuzzy from "fuzzy";
import { getCliPref } from "../../cliPref.js";
import { type DeviceNameResolver } from "../../deviceNameLookup.js";
import { runPromptWithExitHandling } from "../../prompt.js";
import { downloadArtifact } from "../get.js";
import { getCachedModelCatalogOrFetch } from "./catalogHelpers.js";
import { createModelDisplayOptions } from "./index.js";
import { getOwnerNameFromModelName, loadModelWithProgress } from "./util.js";

const MODEL_SELECTION_MESSAGE = "Select a model to chat with";

export async function maybeGetLLM(
  client: LMStudioClient,
  modelKey: string | undefined,
  ttl: number,
  shouldFetchModelCatalog: boolean,
  logger: SimpleLogger,
  yes: boolean | undefined,
  deviceNameResolver: DeviceNameResolver,
): Promise<LLM | undefined> {
  let llm: LLM;
  const isModelRequested = modelKey !== undefined && modelKey !== "";
  const cliPref = await getCliPref(logger);

  try {
    if (isModelRequested) {
      // Load the requested model if specified
      llm = await loadModelWithProgress(client, modelKey, ttl, logger);
    } else {
      // Try to use a loaded model if no model is specified
      llm = await client.llm.model();
    }
    return llm;
  } catch (e) {
    if (!process.stdin.isTTY) {
      if (isModelRequested !== true) {
        logger.error("No loaded model found, load with:\n       lms load");
      } else {
        logger.error(`Model "${modelKey}" not found, load with:\n       lms load ${modelKey}`);
      }
      process.exit(1);
    }
    // Try downloading the model directly if requested
    if (isModelRequested) {
      const getOwnerNameResult = getOwnerNameFromModelName(modelKey);
      if (getOwnerNameResult !== null) {
        const { owner, name } = getOwnerNameResult;
        try {
          await downloadArtifact(client, logger, owner, name, yes ?? false);
          // Downloads are always local for now; force loading on local device.
          // TODO: Change this when we have remote downloads supported
          llm = await loadModelWithProgress(client, modelKey, ttl, logger, {
            deviceIdentifier: null,
          });
          return llm;
        } catch (e) {
          // No op, will fall back to model selection below
        }
      } else {
        logger.errorText`
          Invalid model name '${modelKey}'. Please provide a model name in the format
          'owner/model-name'.
        `;
        process.exit(1);
      }
    } else {
      return undefined;
    }
    if (yes === true) {
      // This means no model has been loaded and user has passed -y/--yes so we cannot ask them to
      // select a model Instead, we exit with an error and tell them to load a model
      if (isModelRequested) {
        // User requested a specific model but it could not be loaded or downloaded
        logger.errorText`
          Unable to download or load the requested model '${modelKey}'. Please check the model name
          and try downloading it first with 'lms get'.
        `;
      } else {
        // No model requested and no model loaded
        logger.error("No loaded model found, load with:\n       lms load");
      }
      process.exit(1);
    } else {
      logger.error("Did not find the model. Please select a model to use:");
    }

    // No model loaded, offer to download a model from the catalog or use existing downloaded
    // model
    let modelCatalogModels: HubModel[] = [];

    if (shouldFetchModelCatalog) {
      modelCatalogModels = await getCachedModelCatalogOrFetch(client, logger);
    }
    const modelCatalogModelNames = modelCatalogModels.map(m => m.owner + "/" + m.name);

    const lastLoadedModels = cliPref.get().lastLoadedModels ?? [];
    const lastLoadedIndexToPathMap = [...lastLoadedModels.entries()];
    const lastLoadedMap = new Map(lastLoadedIndexToPathMap.map(([index, path]) => [path, index]));
    const models = (await client.system.listDownloadedModels())
      .filter(model => model.architecture?.toLowerCase().includes("clip") !== true)
      .sort((a, b) => {
        const aIndex = lastLoadedMap.get(a.path) ?? lastLoadedMap.size + 1;
        const bIndex = lastLoadedMap.get(b.path) ?? lastLoadedMap.size + 1;
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0;
      });
    const filteredModels = models.filter(m => modelCatalogModelNames.includes(m.modelKey) !== true);
    const downloadedDevicesByModelKey = new Map<string, Array<string | null>>();
    for (const model of models) {
      const deviceIdentifier = model.deviceIdentifier ?? null;
      const entry = downloadedDevicesByModelKey.get(model.modelKey);
      if (entry === undefined) {
        downloadedDevicesByModelKey.set(model.modelKey, [deviceIdentifier]);
      } else {
        entry.push(deviceIdentifier);
      }
    }

    const getSelectionKey = (key: string, deviceIdentifier: string | null) =>
      `${key}::${deviceIdentifier ?? "local"}`;

    const getDownloadedDevices = (modelKey: string): Array<string | null> => {
      const devices = downloadedDevicesByModelKey.get(modelKey);
      if (devices === undefined || devices.length === 0) {
        return [];
      }
      return Array.from(new Set(devices));
    };

    type ModelEntry = {
      name: string;
      isDownloaded: boolean;
      size: number;
      inModelCatalog: boolean;
      selectionKey: string;
      deviceName: string | null;
      deviceIdentifier: string | null;
    };

    const modelsMap: ModelEntry[] = [
      ...modelCatalogModels
        .flatMap<ModelEntry>(m => {
          const modelKey = m.owner + "/" + m.name;
          const downloadedDevices = getDownloadedDevices(modelKey);
          if (downloadedDevices.length === 0) {
            return [
              {
                name: modelKey,
                isDownloaded: false,
                size: m.metadata.minMemoryUsageBytes,
                inModelCatalog: true,
                selectionKey: getSelectionKey(modelKey, null),
                deviceName: null,
                deviceIdentifier: null,
              },
            ];
          }
          return downloadedDevices.map(deviceIdentifier => ({
            name: modelKey,
            isDownloaded: true,
            size: m.metadata.minMemoryUsageBytes,
            inModelCatalog: true,
            selectionKey: getSelectionKey(modelKey, deviceIdentifier),
            deviceName: deviceNameResolver.label(deviceIdentifier),
            deviceIdentifier,
          }));
        })
        .sort(m => (m.isDownloaded === true ? -1 : 1)),
      ...filteredModels.map(m => {
        return {
          name: m.modelKey,
          isDownloaded: true,
          size: m.sizeBytes,
          inModelCatalog: false,
          selectionKey: getSelectionKey(m.modelKey, m.deviceIdentifier),
          deviceName: deviceNameResolver.label(m.deviceIdentifier),
          deviceIdentifier: m.deviceIdentifier,
        };
      }),
    ];

    // Pre-compute all display options to avoid recreation on each keystroke
    const displayOptions = createModelDisplayOptions(modelsMap, !shouldFetchModelCatalog);

    const selectedModelKey = await runPromptWithExitHandling(() =>
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

    const selectedModel = modelsMap.find(
      modelEntry => modelEntry.selectionKey === selectedModelKey,
    );

    if (selectedModel === undefined) {
      logger.error("No model selected, exiting.");
      process.exit(1);
    }
    if (!selectedModel.isDownloaded) {
      if (selectedModel.inModelCatalog) {
        const [owner, name] = selectedModel.name.split("/");
        await downloadArtifact(client, logger, owner, name, yes ?? false);
      } else {
        // It is not a model from the catalog, so must be a direct model which is not downloaded,
        // unexpected path as only cataloged models are offered to download
        logger.errorText`
            Model ${selectedModel.name} is not downloaded. Please download the model first with
            'lms get'.
          `;
        process.exit(1);
      }
    }
    const loadDeviceIdentifier = selectedModel.isDownloaded ? selectedModel.deviceIdentifier : null;
    llm = await loadModelWithProgress(client, selectedModel.name, ttl, logger, {
      deviceIdentifier: loadDeviceIdentifier,
      deviceName: selectedModel.deviceName ?? undefined,
    });
  }
  return llm;
}
