import { type DownloadedModel } from "@lmstudio/sdk";
import chalk from "chalk";
import { command, flag } from "cmd-ts";
import columnify from "columnify";
import { architectureInfoLookup } from "../architectureStylizations";
import { createClient } from "../createClient";
import { formatSizeBytesWithColor1000 } from "../formatSizeBytes1000";
import { createLogger, logLevelArgs } from "../logLevel";

function loadedCheck(count: number) {
  if (count === 0) {
    return "";
  } else if (count === 1) {
    return chalk.bgGreenBright.black(" ✓ LOADED ");
  } else {
    return chalk.bgGreenBright.black(` ✓ LOADED (${count}) `);
  }
}

function architecture(architecture?: string) {
  if (!architecture) {
    return "";
  }
  const architectureInfo = architectureInfoLookup.find(architecture);
  return architectureInfo.colorer(architectureInfo.name);
}

function printDownloadedModelsTable(
  title: string,
  downloadedModels: Array<DownloadedModel>,
  loadedModels: Array<{ address: string; identifier: string }>,
) {
  interface DownloadedModelWithExtraInfo extends DownloadedModel {
    loadedIdentifiers: Array<string>;
    group: string;
    remaining: string;
  }
  const downloadedModelsGroups = downloadedModels
    // Attach 1) all the loadedIdentifiers 2) group name (user/repo) to each model
    .map(model => {
      const segments = model.address.split("/");
      return {
        ...model,
        loadedIdentifiers: loadedModels
          .filter(loadedModel => loadedModel.address === model.address)
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

  const downloadedModelsAndHeadlines = [...downloadedModelsGroups.entries()].flatMap(
    ([group, models]) => {
      if (models.length === 1 && models[0].remaining === "") {
        // Group is a model itself
        const model = models[0];
        return {
          address: chalk.grey(" ") + chalk.cyanBright(group),
          sizeBytes: formatSizeBytesWithColor1000(model.sizeBytes),
          arch: architecture(model.architecture),
          loaded: loadedCheck(model.loadedIdentifiers.length),
        };
      }
      return [
        // Empty line between groups
        {},
        // Group title
        { address: chalk.grey(" ") + chalk.cyanBright(group) },
        // Models within the group
        ...models.map(model => ({
          address: chalk.grey("   ") + chalk.white("/" + model.remaining),
          sizeBytes: formatSizeBytesWithColor1000(model.sizeBytes),
          arch: architecture(model.architecture),
          loaded: loadedCheck(model.loadedIdentifiers.length),
        })),
      ];
    },
  );

  console.info(title);
  console.info();
  console.info(
    columnify(downloadedModelsAndHeadlines, {
      columns: ["address", "sizeBytes", "arch", "loaded"],
      config: {
        address: {
          headingTransform: () => chalk.gray(" ") + chalk.greenBright("ADDRESS"),
        },
        sizeBytes: {
          headingTransform: () => chalk.greenBright("SIZE"),
          align: "right",
        },
        arch: {
          headingTransform: () => chalk.greenBright("ARCHITECTURE"),
          align: "center",
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
}

export const ls = command({
  name: "ls",
  description: "List all downloaded models",
  args: {
    ...logLevelArgs,
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
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger);

    const { llm, embedding, json } = args;

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

    console.info();
    console.info();

    const llms = downloadedModels.filter(model => model.type === "llm");
    if (llms.length > 0) {
      printDownloadedModelsTable(
        chalk.bgGreenBright.black("   LLM   ") + " " + chalk.green("(Large Language Models)"),
        llms,
        loadedModels,
      );
      console.info();
      console.info();
    }

    const embeddings = downloadedModels.filter(model => model.type === "embedding");
    if (embeddings.length > 0) {
      printDownloadedModelsTable(
        chalk.bgGreenBright.black("   Embeddings   "),
        embeddings,
        loadedModels,
      );
      console.info();
      console.info();
    }
  },
});

export const ps = command({
  name: "ps",
  description: "List all loaded models",
  args: {
    ...logLevelArgs,
    json: flag({
      long: "json",
      description: "Outputs in JSON format to stdout",
    }),
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger);

    const { json } = args;

    const loadedModels = await client.llm.listLoaded();
    const downloadedModels = await client.system.listDownloadedModels();

    if (json) {
      console.info(JSON.stringify(loadedModels));
      return;
    }

    if (loadedModels.length === 0) {
      console.info(chalk.redBright("You have not loaded any models yet."));
      return;
    }

    console.info();
    console.info(chalk.bgCyanBright.black("   LOADED MODELS   "));
    console.info();

    const dot = chalk.blackBright("  • ");

    for (const { identifier, address } of loadedModels) {
      const model = downloadedModels.find(model => model.address === address);
      console.info(chalk.greenBright(`Identifier: ${chalk.green(identifier)}`));
      if (model === undefined) {
        console.info(chalk.gray("  Cannot find more information"));
      } else {
        console.info(dot + chalk.whiteBright(`Type: ${chalk.bgGreenBright.black(" LLM ")}`));
        console.info(dot + chalk.whiteBright(`Address: ${chalk.white(address)}`));
        console.info(
          dot + chalk.whiteBright(`Size: ${formatSizeBytesWithColor1000(model.sizeBytes)}`),
        );
        console.info(dot + chalk.whiteBright(`Architecture: ${architecture(model.architecture)}`));
        console.info();
      }
    }
  },
});
