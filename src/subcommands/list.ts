import { Command } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { type ModelInfo } from "@lmstudio/sdk";
import chalk from "chalk";
import columnify from "columnify";
import { architectureInfoLookup } from "../architectureStylizations.js";
import { addCreateClientOptions, createClient } from "../createClient.js";
import { formatTimeLean } from "../formatElapsedTime.js";
import { formatSizeBytes1000 } from "../formatSizeBytes1000.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";

function loadedCheck(count: number) {
  if (count === 0) {
    return "";
  } else if (count === 1) {
    return chalk.green("✓ LOADED");
  } else {
    return chalk.green(`✓ LOADED (${count})`);
  }
}

function architecture(architecture?: string) {
  if (architecture === undefined) {
    return "";
  }
  return architectureInfoLookup.find(architecture).name;
}

function formatModelKeyWithVariantCount(model: ModelInfo) {
  if (model.variants === undefined) {
    return model.modelKey;
  }
  const variantCount = model.variants.length;
  const variantLabel = variantCount === 1 ? "variant" : "variants";
  return `${model.modelKey}${chalk.gray(` (${variantCount} ${variantLabel})`)}`;
}

function printDownloadedModelsTable(
  title: string,
  downloadedModels: Array<ModelInfo>,
  loadedModels: Array<{ path: string; identifier: string }>,
) {
  const sortedModels = [...downloadedModels].sort((firstModel, secondModel) =>
    firstModel.modelKey.localeCompare(secondModel.modelKey),
  );
  const downloadedModelsAndHeadlines = sortedModels.map(model => {
    return {
      path: formatModelKeyWithVariantCount(model),
      sizeBytes: formatSizeBytes1000(model.sizeBytes),
      params: model.paramsString,
      arch: architecture(model.architecture),
      loaded: loadedCheck(
        loadedModels.filter(loadedModel => loadedModel.path === model.path).length,
      ),
    };
  });

  console.info(
    columnify(downloadedModelsAndHeadlines, {
      columns: ["path", "params", "arch", "sizeBytes", "loaded"],
      config: {
        loaded: {
          headingTransform: () => "",
          align: "left",
        },
        path: {
          headingTransform: () => chalk.grey(title),
        },
        params: {
          headingTransform: () => chalk.grey("PARAMS"),
          align: "left",
        },
        arch: {
          headingTransform: () => chalk.grey("ARCH"),
          align: "left",
        },
        sizeBytes: {
          headingTransform: () => chalk.grey("SIZE"),
          align: "left",
        },
      },
      preserveNewLines: true,
      columnSplitter: "    ",
    }),
  );
}

interface PrintModelsWithVariantRowsOpts {
  title: string;
  baseModels: Array<ModelInfo>;
  loadedModels: Array<{ path: string; identifier: string }>;
  variantInfosByModelKey: Map<string, Array<ModelInfo>>;
}

function printModelsWithVariantRows({
  title,
  baseModels,
  loadedModels,
  variantInfosByModelKey,
}: PrintModelsWithVariantRowsOpts) {
  const sortedBaseModels = [...baseModels].sort((firstModel, secondModel) =>
    firstModel.modelKey.localeCompare(secondModel.modelKey),
  );

  const rows = sortedBaseModels.flatMap(model => {
    const variantCount = model.variants === undefined ? 0 : model.variants.length;
    const basePath = formatModelKeyWithVariantCount(model);
    const baseRow =
      variantCount === 0
        ? {
            path: basePath,
            params: model.paramsString,
            arch: architecture(model.architecture),
            sizeBytes: formatSizeBytes1000(model.sizeBytes),
            loaded: loadedCheck(
              loadedModels.filter(loadedModel => loadedModel.path === model.path).length,
            ),
          }
        : { path: basePath };

    const variantInfos = variantInfosByModelKey.get(model.modelKey);
    if (variantInfos === undefined) {
      return [baseRow];
    }

    const selectedVariantKey = model.selectedVariant;
    const variantRows = variantInfos.map(variantInfo => {
      const isSelectedVariant =
        selectedVariantKey !== undefined && selectedVariantKey === variantInfo.modelKey;
      return {
        path: `${chalk.gray(isSelectedVariant ? " * " : "   ")}${variantInfo.modelKey}`,
        params: variantInfo.paramsString,
        arch: architecture(variantInfo.architecture),
        sizeBytes: formatSizeBytes1000(variantInfo.sizeBytes),
        loaded: loadedCheck(
          loadedModels.filter(loadedModel => loadedModel.path === variantInfo.path).length,
        ),
      };
    });

    return [baseRow, ...variantRows];
  });

  console.info(
    columnify(rows, {
      columns: ["path", "params", "arch", "sizeBytes", "loaded"],
      config: {
        loaded: {
          headingTransform: () => "",
          align: "left",
        },
        path: {
          headingTransform: () => chalk.grey(title),
        },
        params: {
          headingTransform: () => chalk.grey("PARAMS"),
          align: "left",
        },
        arch: {
          headingTransform: () => chalk.grey("ARCH"),
          align: "left",
        },
        sizeBytes: {
          headingTransform: () => chalk.grey("SIZE"),
          align: "left",
        },
      },
      preserveNewLines: true,
      columnSplitter: "    ",
    }),
  );
}

export const ls = addCreateClientOptions(
  addLogLevelOptions(
    new Command()
      .name("ls")
      .description("List all downloaded models")
      .argument("[modelKey]", "Show variants for the provided model key")
      .option("--llm", "Show only LLM models")
      .option("--embedding", "Show only embedding models")
      .option("--detailed", "[Deprecated] Show detailed view with grouping")
      .option("--variants", "Show variants for all models")
      .option("--json", "Outputs in JSON format to stdout"),
  ),
).action(async (modelKey: string | undefined, options) => {
  const logger = createLogger(options);
  const client = await createClient(logger, options);

  const {
    llm = false,
    embedding = false,
    detailed = false,
    variants: variantsOption = false,
    json = false,
  } = options;

  if (modelKey !== undefined && variantsOption) {
    logger.error(chalk.red("Cannot combine a model key argument with --variants."));
    process.exit(1);
    return;
  }

  if (detailed) {
    logger.warn(
      chalk.yellow("The '--detailed' flag is deprecated. Output is the same as 'lms ls'"),
    );
  }

  if (modelKey !== undefined) {
    const variants = await client.system.listDownloadedModelVariants(modelKey);

    if (json) {
      console.info(JSON.stringify(variants));
      return;
    }

    const loadedModels = await client.llm.listLoaded();
    const firstVariantType = variants[0]?.type;
    const variantTitle = firstVariantType === "embedding" ? "EMBEDDING" : "LLM";

    console.info();
    console.info(`Listing variants for ${modelKey}:`);
    console.info();
    printDownloadedModelsTable(variantTitle, variants, loadedModels);
    console.info();
    return;
  }

  const allDownloadedModels = await client.system.listDownloadedModels();
  const loadedModels = await client.llm.listLoaded();

  const originalModelsCount = allDownloadedModels.length;

  let filteredDownloadedModels = allDownloadedModels;
  if (llm || embedding) {
    const allowedTypes = new Set<string>();
    if (llm) {
      allowedTypes.add("llm");
    }
    if (embedding) {
      allowedTypes.add("embedding");
    }
    filteredDownloadedModels = allDownloadedModels.filter(model => allowedTypes.has(model.type));
  }

  const filteredModelsCount = filteredDownloadedModels.length;

  if (json) {
    if (variantsOption) {
      const modelsWithVariants = filteredDownloadedModels.filter(model => {
        if (model.variants === undefined) {
          return false;
        }
        return model.variants.length > 0;
      });
      const variantGroups = await Promise.all(
        modelsWithVariants.map(async model => {
          const variants = await client.system.listDownloadedModelVariants(model.modelKey);
          return { model, variants };
        }),
      );
      console.info(JSON.stringify(variantGroups));
      return;
    }

    console.info(JSON.stringify(filteredDownloadedModels));
    return;
  }

  if (filteredModelsCount === 0) {
    if (originalModelsCount === 0) {
      console.info(chalk.red("You have not downloaded any models yet."));
    } else {
      console.info(
        chalk.red(`You have ${originalModelsCount} models, but none of them match the filter.`),
      );
    }
    return;
  }

  let totalSizeBytes = 0;
  for (const model of filteredDownloadedModels) {
    totalSizeBytes += model.sizeBytes;
  }

  console.info();
  console.info(text`
    You have ${filteredDownloadedModels.length} models,
    taking up ${formatSizeBytes1000(totalSizeBytes)} of disk space.
  `);
  console.info();

  if (variantsOption) {
    const variantInfosByModelKey = new Map<string, Array<ModelInfo>>();
    const modelsWithVariants = filteredDownloadedModels.filter(model => {
      if (model.variants === undefined) {
        return false;
      }
      return model.variants.length > 0;
    });
    const variantEntries = await Promise.all(
      modelsWithVariants.map(async model => {
        const variants = await client.system.listDownloadedModelVariants(model.modelKey);
        return { modelKey: model.modelKey, variants };
      }),
    );
    for (const entry of variantEntries) {
      variantInfosByModelKey.set(entry.modelKey, entry.variants);
    }

    const llmModels = filteredDownloadedModels.filter(model => model.type === "llm");
    if (llmModels.length > 0) {
      printModelsWithVariantRows({
        title: "LLM",
        baseModels: llmModels,
        loadedModels,
        variantInfosByModelKey,
      });
      console.info();
    }

    const embeddingModels = filteredDownloadedModels.filter(model => model.type === "embedding");
    if (embeddingModels.length > 0) {
      printModelsWithVariantRows({
        title: "EMBEDDING",
        baseModels: embeddingModels,
        loadedModels,
        variantInfosByModelKey,
      });
      console.info();
    }
    return;
  }

  const llmModels = filteredDownloadedModels.filter(model => model.type === "llm");
  if (llmModels.length > 0) {
    printDownloadedModelsTable("LLM", llmModels, loadedModels);
    console.info();
  }

  const embeddingModels = filteredDownloadedModels.filter(model => model.type === "embedding");
  if (embeddingModels.length > 0) {
    printDownloadedModelsTable("EMBEDDING", embeddingModels, loadedModels);
    console.info();
  }
});

export const ps = addCreateClientOptions(
  addLogLevelOptions(
    new Command()
      .name("ps")
      .description("List all loaded models")
      .option("--json", "Outputs in JSON format to stdout"),
  ),
).action(async options => {
  const logger = createLogger(options);
  const client = await createClient(logger, options);

  const { json = false } = options;

  const loadedModels = [
    ...(await client.llm.listLoaded()),
    ...(await client.embedding.listLoaded()),
  ];

  if (json) {
    const modelInfos = await Promise.all(
      loadedModels.map(async model => {
        const info = await model.getModelInfo();
        const { instanceReference: _, ...filteredInfo } = info;
        const instanceProcessingState = await model.getInstanceProcessingState();
        return {
          ...filteredInfo,
          status: instanceProcessingState.status,
          queued: instanceProcessingState.queued,
        };
      }),
    );
    console.info(JSON.stringify(modelInfos));
    return;
  }

  if (loadedModels.length === 0) {
    logger.info(
      text`
        No models are currently loaded

        To load a model, run:

            ${chalk.yellow("lms load")}${"\n"}
      `,
    );
    return;
  }

  const loadedModelsWithInfo = await Promise.all(
    loadedModels.map(async loadedModel => {
      const { identifier } = loadedModel;
      const contextLength = await loadedModel.getContextLength();
      const modelInstanceInfo = await loadedModel.getModelInfo();
      const timeLeft =
        modelInstanceInfo.ttlMs !== null
          ? modelInstanceInfo.lastUsedTime === null
            ? modelInstanceInfo.ttlMs
            : modelInstanceInfo.ttlMs - (Date.now() - modelInstanceInfo.lastUsedTime)
          : undefined;

      const processingState = await loadedModel.getInstanceProcessingState();
      return {
        identifier,
        path: modelInstanceInfo.modelKey,
        sizeBytes: formatSizeBytes1000(modelInstanceInfo.sizeBytes),
        contextLength: contextLength,
        ttlMs:
          timeLeft !== undefined && modelInstanceInfo.ttlMs !== null
            ? `${formatTimeLean(timeLeft)} ${chalk.gray(`/ ${formatTimeLean(modelInstanceInfo.ttlMs)}`)}`
            : "",
        status: processingState.status.toUpperCase(),
      };
    }),
  );

  loadedModelsWithInfo.sort((a, b) => a.identifier.localeCompare(b.identifier));

  console.info();
  console.info(
    columnify(loadedModelsWithInfo, {
      columns: ["identifier", "path", "status", "sizeBytes", "contextLength", "ttlMs"],
      config: {
        identifier: {
          headingTransform: () => chalk.grey("IDENTIFIER"),
          align: "left",
        },
        path: {
          headingTransform: () => chalk.grey("MODEL"),
          align: "left",
        },
        status: {
          headingTransform: () => chalk.grey("STATUS"),
          align: "left",
        },
        sizeBytes: {
          headingTransform: () => chalk.grey("SIZE"),
          align: "left",
        },
        contextLength: {
          headingTransform: () => chalk.grey("CONTEXT"),
          align: "left",
        },
        ttlMs: {
          headingTransform: () => chalk.grey("TTL"),
          align: "left",
        },
      },
      preserveNewLines: true,
      columnSplitter: "    ",
    }),
  );
  console.info();
});
