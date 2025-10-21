import { Command, Option } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { type DownloadableRuntimeExtensionInfo } from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import columnify from "columnify";
import inquirer from "inquirer";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { handleDownloadWithProgressBar } from "../../handleDownloadWithProgressBar.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";

type RuntimeExtensionsSearchOptions = Parameters<
  LMStudioClient["runtime"]["extensions"]["search"]
>[1];

interface RuntimeGetCommandOptions {
  allowIncompatible: boolean;
  channel?: "stable" | "beta";
  list: boolean;
  upgrade: boolean;
  yes: boolean;
}

function buildRuntimeExtensionsSearchOptions(
  channelOverride: "stable" | "beta" | undefined,
  includeIncompatible: boolean,
): RuntimeExtensionsSearchOptions {
  if (channelOverride !== undefined) {
    return {
      channel: channelOverride,
      includeIncompatible,
    };
  }
  if (includeIncompatible === true) {
    return {
      channel: "stable",
      includeIncompatible: true,
    };
  }
  return undefined;
}

async function searchRuntimeExtensions(
  logger: SimpleLogger,
  client: LMStudioClient,
  queryArgument: string | undefined,
  options: RuntimeGetCommandOptions,
): Promise<Array<DownloadableRuntimeExtensionInfo>> {
  const searchQuery = queryArgument ?? "";
  const searchOptions = buildRuntimeExtensionsSearchOptions(
    options.channel,
    options.allowIncompatible,
  );
  const searchResults = await client.runtime.extensions.search(searchQuery, searchOptions);

  let filteredResults: Array<DownloadableRuntimeExtensionInfo> = searchResults;
  if (options.upgrade === true) {
    const selections = await client.runtime.engine.getSelections();
    const selectedNames = new Set(
      [...selections.values()].map(engineSpecifier => engineSpecifier.name),
    );
    // Filter to only extensions that are already selected.
    filteredResults = filteredResults.filter(runtimeExtension =>
      selectedNames.has(runtimeExtension.name),
    );
  }

  if (filteredResults.length === 0) {
    if (options.upgrade === true) {
      logger.info("No matching runtime extensions need an upgrade.");
    } else {
      logger.info("No runtime extensions matched the query.");
    }
    process.exit(0);
  }

  return filteredResults;
}

function renderRuntimeExtensionsList(
  logger: SimpleLogger,
  runtimeExtensions: Array<DownloadableRuntimeExtensionInfo>,
) {
  const sortedExtensions = [...runtimeExtensions].sort((firstExtension, secondExtension) => {
    const packageComparison = firstExtension.package.localeCompare(secondExtension.package);
    if (packageComparison !== 0) {
      return packageComparison;
    }
    const nameComparison = firstExtension.name.localeCompare(secondExtension.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }
    return compareVersions(secondExtension.version, firstExtension.version);
  });

  const rows = sortedExtensions.map(runtimeExtension => {
    return {
      name: runtimeExtension.name,
      version: runtimeExtension.version,
      localVersion: runtimeExtension.localVersions.join(chalk.gray(" / ")) ?? chalk.gray("-"),
    };
  });

  const table = columnify(rows, {
    columns: ["name", "version", "localVersion"],
    config: {
      name: {
        headingTransform: () => "NAME",
        align: "left",
      },
      version: {
        headingTransform: () => "VERSION",
        align: "left",
      },
      localVersion: {
        headingTransform: () => "LOCAL VERSIONS",
        align: "left",
      },
    },
    columnSplitter: "    ",
  });

  logger.info(table);
}

async function selectRuntimeExtension(
  logger: SimpleLogger,
  runtimeExtensions: Array<DownloadableRuntimeExtensionInfo>,
  options: RuntimeGetCommandOptions,
): Promise<DownloadableRuntimeExtensionInfo> {
  if (runtimeExtensions.length === 1) {
    return runtimeExtensions[0];
  }

  if (options.yes === true) {
    logger.warn(
      "Multiple runtime extensions matched the query. Selecting the first result because --yes was provided.",
    );
    return runtimeExtensions[0];
  }

  const isStdoutInteractive = process.stdout.isTTY === true;
  const isStdinInteractive = process.stdin.isTTY === true;
  if (isStdoutInteractive === true && isStdinInteractive === true) {
    const promptChoices = runtimeExtensions.map((runtimeExtension, extensionIndex) => ({
      name: runtimeExtension.name + "@" + runtimeExtension.version,
      value: extensionIndex,
    }));

    const promptAnswer = await inquirer.prompt<{ extensionIndex: number }>([
      {
        type: "list",
        name: "extensionIndex",
        message: "Multiple runtime extensions matched the query. Select one to download:",
        choices: promptChoices,
      },
    ]);

    return runtimeExtensions[promptAnswer.extensionIndex];
  }

  logger.error(
    "Multiple runtime extensions matched the query. Re-run with a more specific query or use -l to list all matches.",
  );
  process.exit(1);
}

async function downloadRuntimeExtension(
  logger: SimpleLogger,
  client: LMStudioClient,
  runtimeExtension: DownloadableRuntimeExtensionInfo,
) {
  logger.info("Downloading " + runtimeExtension.name + "@" + runtimeExtension.version + "...");
  await handleDownloadWithProgressBar(logger, async downloadOpts => {
    await client.runtime.extensions.download(
      { name: runtimeExtension.name, version: runtimeExtension.version },
      {
        onProgress: downloadOpts.onProgress,
        onStartFinalizing: downloadOpts.onStartFinalizing,
        signal: downloadOpts.signal,
      },
    );
  });
  logger.info("Download completed. Select the runtime using:");
  logger.info();
  logger.info(`  lms runtime select ${runtimeExtension.name}-${runtimeExtension.version}`);
}

export const get = addLogLevelOptions(
  addCreateClientOptions(
    new Command().name("get").description("Download or list runtime extensions."),
  )
    .argument("[query]", "Query runtime extensions by name, version, platform, or hardware filters")
    .option("-l, --list", "List runtime extensions without downloading")
    .option("-y, --yes", "Automatically pick the first result when multiple matches are found")
    .option("-u, --upgrade", "Only include runtime extensions that are already installed locally")
    .option("--allow-incompatible", "Include runtime extensions that are incompatible")
    .addOption(
      new Option(
        "--channel <channel>",
        "Override the runtime extension channel to query from",
      ).choices(["stable", "beta"]),
    )
    .action(async function (queryArgument: string | undefined, commandOptions) {
      const parentOptions = this.parent?.opts() ?? {};
      const logger = createLogger(parentOptions);
      const client = await createClient(logger, parentOptions);

      const runtimeGetOptions = commandOptions as RuntimeGetCommandOptions;

      const runtimeExtensions = await searchRuntimeExtensions(
        logger,
        client,
        queryArgument,
        runtimeGetOptions,
      );

      if (runtimeGetOptions.list === true) {
        renderRuntimeExtensionsList(logger, runtimeExtensions);
        return;
      }

      const runtimeExtension = await selectRuntimeExtension(
        logger,
        runtimeExtensions,
        runtimeGetOptions,
      );
      await downloadRuntimeExtension(logger, client, runtimeExtension);
    }),
);
