import { type DownloadedModel } from "@lmstudio/sdk";
import chalk from "chalk";
import { command, subcommands } from "cmd-ts";
import columnify from "columnify";
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

function coloredArch(arch?: string) {
  return arch ?? "";
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
          address: chalk.whiteBright(group),
          sizeBytes: formatSizeBytesWithColor1000(model.sizeBytes),
          arch: coloredArch(model.architecture),
          loaded: loadedCheck(model.loadedIdentifiers.length),
        };
      }
      return [
        // Group title
        { address: chalk.whiteBright(group), sizeBytes: "", arch: "", loaded: "" },
        // Models
        ...models.map(model => ({
          address: chalk.black(". ") + chalk.gray("/" + model.remaining),
          sizeBytes: formatSizeBytesWithColor1000(model.sizeBytes),
          arch: coloredArch(model.architecture),
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
          headingTransform: () => chalk.cyanBright("ADDRESS"),
        },
        sizeBytes: {
          headingTransform: () => chalk.cyanBright("SIZE"),
          align: "right",
        },
        arch: {
          headingTransform: () => chalk.cyanBright("ARCHITECTURE"),
          align: "left",
        },
        loaded: {
          headingTransform: () => chalk.cyanBright("LOADED"),
          align: "left",
        },
      },
      preserveNewLines: true,
      columnSplitter: "  ",
    }),
  );
}

const downloaded = command({
  name: "downloaded",
  description: "List downloaded models",
  args: {
    ...logLevelArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = createClient(logger);

    const downloadedModels = await client.system.listDownloadedModels();
    const loadedModels = await client.llm.listLoaded();

    console.info();
    console.info();
    printDownloadedModelsTable(
      chalk.bgGreenBright.black(" LLM ") + " " + chalk.green("(Large Language Models)"),
      downloadedModels.filter(model => model.type === "llm"),
      loadedModels,
    );
    console.info();
    console.info();
    printDownloadedModelsTable(
      chalk.bgGreenBright.black(" Embeddings "),
      downloadedModels.filter(model => model.type === "embedding"),
      loadedModels,
    );
    console.info();
    console.info();
  },
});

export const list = subcommands({
  name: "list",
  description: "List models",
  cmds: { downloaded },
});
