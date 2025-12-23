import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LLM, type LMStudioClient } from "@lmstudio/sdk";
import { getOwnerNameFromModelName, loadModelWithProgress } from "./util.js";
import { downloadArtifact } from "../get.js";
import { createModelDisplayOptions } from "./index.js";
import { runPromptWithExitHandling } from "../../prompt.js";
import { search } from "@inquirer/prompts";
import type { HubModel } from "@lmstudio/lms-shared-types";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import fuzzy from "fuzzy";
import { getCachedModelCatalogOrFetch } from "./catalogHelpers.js";
import { getCliPref } from "../../cliPref.js";

const MODEL_SELECTION_MESSAGE = "Select a model to chat with";

export async function maybeGetLLM(
  client: LMStudioClient,
  modelName: string | undefined,
  ttl: number,
  shouldFetchModelCatalog: boolean,
  logger: SimpleLogger,
  yes: boolean | undefined,
): Promise<LLM | undefined> {
  let llm: LLM;
  const isModelRequested = modelName !== undefined && modelName !== "";
  const cliPref = await getCliPref(logger);

  try {
    if (isModelRequested) {
      // Load the requested model if specified
      llm = await loadModelWithProgress(client, modelName, ttl, logger);
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
        logger.error(`Model "${modelName}" not found, load with:\n       lms load ${modelName}`);
      }
      process.exit(1);
    }
    // Try downloading the model directly if requested
    if (isModelRequested) {
      const getOwnerNameResult = getOwnerNameFromModelName(modelName);
      if (getOwnerNameResult !== null) {
        const { owner, name } = getOwnerNameResult;
        try {
          await downloadArtifact(client, logger, owner, name, yes ?? false);
          llm = await loadModelWithProgress(client, modelName, ttl, logger);
          return llm;
        } catch (e) {
          // No op, will fall back to model selection below
        }
      } else {
        logger.errorText`
          Invalid model name '${modelName}'. Please provide a model name in the format
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
          Unable to download or load the requested model '${modelName}'. Please check the model name
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
    const modelKeys = models.map(model => model.modelKey);

    const modelsMap = [
      ...modelCatalogModels
        .map(m => {
          return {
            name: m.owner + "/" + m.name,
            isDownloaded: modelKeys.includes(m.owner + "/" + m.name),
            size: m.metadata.minMemoryUsageBytes,
            inModelCatalog: true,
          };
        })
        .sort(m => (m.isDownloaded === true ? -1 : 1)),
      ...filteredModels.map(m => {
        return {
          name: m.path,
          isDownloaded: true,
          size: m.sizeBytes,
          inModelCatalog: false,
        };
      }),
    ];

    // Pre-compute all display options to avoid recreation on each keystroke
    const displayOptions = createModelDisplayOptions(modelsMap, !shouldFetchModelCatalog);

    const selectedModelName = await runPromptWithExitHandling(() =>
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

    const selectedModel = modelsMap.find(modelEntry => modelEntry.name === selectedModelName);

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
    llm = await loadModelWithProgress(client, selectedModel.name, ttl, logger);
  }
  return llm;
}
