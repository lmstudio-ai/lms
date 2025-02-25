import { text } from "@lmstudio/lms-common";
import { type ModelInfo } from "@lmstudio/sdk";
import chalk from "chalk";
import { command, flag } from "cmd-ts";
import columnify from "columnify";
import { architectureInfoLookup } from "../architectureStylizations.js";
import { createClient, createClientArgs } from "../createClient.js";
import { formatSizeBytes1000, formatSizeBytesWithColor1000 } from "../formatSizeBytes1000.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

function loadedCheckBoxed(count: number) {
  if (count === 0) {
    return "";
  } else if (count === 1) {
    return chalk.bgGreenBright.black(" ✓ LOADED ");
  } else {
    return chalk.bgGreenBright.black(` ✓ LOADED (${count}) `);
  }
}

function loadedCheck(count: number) {
  if (count === 0) {
    return "";
  } else if (count === 1) {
    return chalk.greenBright("✓ LOADED");
  } else {
    return chalk.greenBright(`✓ LOADED (${count})`);
  }
}

function architectureColored(architecture?: string) {
  if (!architecture) {
    return "";
  }
  const architectureInfo = architectureInfoLookup.find(architecture);
  return architectureInfo.colorer(architectureInfo.name);
}

function architecture(architecture?: string) {
  if (!architecture) {
    return "";
  }
  return architectureInfoLookup.find(architecture).name;
}

function printDownloadedModelsTable(
  title: string,
  downloadedModels: Array<ModelInfo>,
  loadedModels: Array<{ path: string; identifier: string }>,
  detailed: boolean,
) {
  if (detailed) {
    interface DownloadedModelWithExtraInfo {
      model: ModelInfo;
      loadedIdentifiers: Array<string>;
      group: string;
      remaining: string;
    }
    const downloadedModelsGroups = downloadedModels
      // Attach 1) all the loadedIdentifiers 2) group name (user/repo) to each model
      .map(model => {
        const segments = model.path.split("/");
        return {
          model,
          loadedIdentifiers: loadedModels
            .filter(loadedModel => loadedModel.path === model.path)
            .map(loadedModel => loadedModel.identifier),
          group: segments.slice(0, 2).join("/"),
          remaining: segments.slice(2).join("/"),
        };
      })
      // Group by group name into a map
      .reduce((acc, model) => {
        let group = acc.get(model.group);
        if (!group) {
          group = [];
          acc.set(model.group, group);
        }
        group.push(model);
        return acc;
      }, new Map<string, Array<DownloadedModelWithExtraInfo>>());

    console.info(title);
    console.info();

    const downloadedModelsAndHeadlines = [...downloadedModelsGroups.entries()].flatMap(
      ([group, models]) => {
        if (models.length === 1 && models[0].remaining === "") {
          // Group is a model itself
          const model = models[0];
          return {
            path: chalk.grey(" ") + chalk.cyanBright(group),
            sizeBytes: formatSizeBytesWithColor1000(model.model.sizeBytes),
            arch: architectureColored(model.model.architecture),
            loaded: loadedCheckBoxed(model.loadedIdentifiers.length),
          };
        }
        return [
          // Empty line between groups
          {},
          // Group title
          { path: chalk.grey(" ") + chalk.cyanBright(group) },
          // Models within the group
          ...models.map(model => ({
            path: chalk.grey("   ") + chalk.white("/" + model.remaining),
            key: model.model.modelKey,
            sizeBytes: formatSizeBytesWithColor1000(model.model.sizeBytes),
            params: model.model.paramsString ?? "",
            arch: architectureColored(model.model.architecture),
            loaded: loadedCheckBoxed(model.loadedIdentifiers.length),
          })),
        ];
      },
    );

    console.info(
      columnify(downloadedModelsAndHeadlines, {
        columns: ["path", "key", "params", "arch", "sizeBytes", "loaded"],
        config: {
          path: {
            headingTransform: () => chalk.gray(" ") + chalk.greenBright("PATH"),
          },
          key: {
            headingTransform: () => chalk.greenBright("KEY"),
            align: "left",
          },
          params: {
            headingTransform: () => chalk.greenBright("PARAMS"),
            align: "right",
          },
          arch: {
            headingTransform: () => chalk.greenBright("ARCHITECTURE"),
            align: "center",
          },
          sizeBytes: {
            headingTransform: () => chalk.greenBright("SIZE"),
            align: "right",
          },
          loaded: {
            headingTransform: () => chalk.greenBright("LOADED"),
            align: "left",
          },
        },
        preserveNewLines: true,
        columnSplitter: "  ",
      }),
    );
  } else {
    const downloadedModelsAndHeadlines = downloadedModels.map(model => {
      return {
        path: chalk.cyanBright(model.modelKey),
        sizeBytes: chalk.cyanBright(formatSizeBytes1000(model.sizeBytes)),
        params: chalk.cyanBright(model.paramsString ?? ""),
        arch: chalk.cyanBright(architecture(model.architecture)),
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
            headingTransform: () => chalk(title),
          },
          params: {
            headingTransform: () => chalk("PARAMS"),
            align: "right",
          },
          arch: {
            headingTransform: () => chalk("ARCHITECTURE"),
            align: "center",
          },
          sizeBytes: {
            headingTransform: () => chalk("SIZE"),
            align: "right",
          },
        },
        preserveNewLines: true,
        columnSplitter: "      ",
      }),
    );
  }
}

export const ls = command({
  name: "ls",
  description: "List all downloaded models",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
    llm: flag({
      long: "llm",
      description: "Show only LLM models",
    }),
    embedding: flag({
      long: "embedding",
      description: "Show only embedding models",
    }),
    json: flag({
      long: "json",
      description: "Outputs in JSON format to stdout",
    }),
    detailed: flag({
      long: "detailed",
      description: "Show detailed information",
    }),
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);

    const { llm, embedding, json, detailed } = args;

    let downloadedModels = await client.system.listDownloadedModels();
    const loadedModels = await client.llm.listLoaded();

    const originalModelsCount = downloadedModels.length;

    if (llm || embedding) {
      const allowedTypes = new Set<string>();
      if (llm) {
        allowedTypes.add("llm");
      }
      if (embedding) {
        allowedTypes.add("embedding");
      }
      downloadedModels = downloadedModels.filter(model => allowedTypes.has(model.type));
    }

    const afterFilteringModelsCount = downloadedModels.length;

    if (json) {
      console.info(JSON.stringify(downloadedModels));
      return;
    }

    if (afterFilteringModelsCount === 0) {
      if (originalModelsCount === 0) {
        console.info(chalk.redBright("You have not downloaded any models yet."));
      } else {
        console.info(
          chalk.redBright(
            `You have ${originalModelsCount} models, but none of them match the filter.`,
          ),
        );
      }
      return;
    }

    let totalSizeBytes = 0;
    for (const model of downloadedModels) {
      totalSizeBytes += model.sizeBytes;
    }

    console.info();
    if (detailed) {
      console.info();
      console.info(text`
        You have ${chalk.greenBright(downloadedModels.length)} models,
        taking up ${chalk.greenBright(formatSizeBytes1000(totalSizeBytes))} of disk space.
      `);
    } else {
      console.info(text`
        You have ${downloadedModels.length} models,
        taking up ${formatSizeBytes1000(totalSizeBytes)} of disk space.
      `);
    }
    console.info();

    const llms = downloadedModels.filter(model => model.type === "llm");
    if (llms.length > 0) {
      printDownloadedModelsTable(
        detailed
          ? chalk.bgGreenBright.black("   LLMs   ") + " " + chalk.green("(Large Language Models)")
          : "LLMs (Large Language Models)",
        llms,
        loadedModels,
        detailed,
      );
      console.info();
    }

    const embeddings = downloadedModels.filter(model => model.type === "embedding");
    if (embeddings.length > 0) {
      printDownloadedModelsTable(
        detailed ? chalk.bgGreenBright.black("   Embedding Models   ") : "Embedding Models",
        embeddings,
        loadedModels,
        detailed,
      );
      console.info();
    }
  },
});

export const ps = command({
  name: "ps",
  description: "List all loaded models",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
    json: flag({
      long: "json",
      description: "Outputs in JSON format to stdout",
    }),
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);

    const { json } = args;

    const loadedModels = [
      ...(await client.llm.listLoaded()),
      ...(await client.embedding.listLoaded()),
    ];
    const downloadedModels = await client.system.listDownloadedModels();

    if (json) {
      console.info(
        JSON.stringify(await Promise.all(loadedModels.map(model => model.getModelInfo()))),
      );
      return;
    }

    if (loadedModels.length === 0) {
      logger.error(
        text`
          No models are currently loaded

          To load a model, run:

              ${chalk.yellow("lms load")}${"\n"}
        `,
      );
      return;
    }

    console.info();
    console.info(chalk.bgCyanBright.black("   LOADED MODELS   "));
    console.info();

    const dot = chalk.blackBright("  • ");

    for (const { identifier, path } of loadedModels) {
      const model = downloadedModels.find(model => model.path === path);
      console.info(chalk.greenBright(`Identifier: ${chalk.green(identifier)}`));
      if (model === undefined) {
        console.info(chalk.gray("  Cannot find more information"));
      } else {
        console.info(
          dot +
            chalk.whiteBright(
              `Type: ${chalk.bgGreenBright.black(model.type === "llm" ? " LLM " : " Embedding ")}`,
            ),
        );
        console.info(dot + chalk.whiteBright(`Path: ${chalk.white(path)}`));
        console.info(
          dot + chalk.whiteBright(`Size: ${formatSizeBytesWithColor1000(model.sizeBytes)}`),
        );
        console.info(
          dot + chalk.whiteBright(`Architecture: ${architectureColored(model.architecture)}`),
        );
        console.info();
      }
    }
  },
});
