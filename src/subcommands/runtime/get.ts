import { Command, Option, type OptionValues } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { type DownloadableRuntimeExtensionInfo } from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import columnify from "columnify";
import { select } from "@inquirer/prompts";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { runPromptWithExitHandling } from "../../prompt.js";
import {
  determineLatestLocalVersion,
  downloadRuntimeExtensionWithErrorHandling,
  formatLatestLocalVersion,
  formatRuntimeUpdateStatus,
  type DownloadRuntimeExtensionResult,
} from "./helpers/runtimeExtensionDownload.js";

interface RuntimeGetCommandOpts {
  allowIncompatible: boolean;
  channel?: string;
  list: boolean;
  yes: boolean;
}

type RuntimeGetCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    allowIncompatible?: boolean;
    channel?: string;
    list?: boolean;
    yes?: boolean;
  };

async function searchRuntimeExtensions(
  logger: SimpleLogger,
  client: LMStudioClient,
  queryArgument: string | undefined,
  opts: RuntimeGetCommandOpts,
): Promise<Array<DownloadableRuntimeExtensionInfo>> {
  const searchQuery = queryArgument ?? "";
  const searchResults = await client.runtime.extensions.search(searchQuery, {
    channel: opts.channel,
    includeIncompatible: opts.allowIncompatible,
  });

  if (searchResults.length === 0) {
    if (opts.allowIncompatible) {
      logger.info("No runtime extensions matched the query.");
    } else {
      // Let's try again including incompatible extensions
      const incompatibleResults = await client.runtime.extensions.search(searchQuery, {
        channel: opts.channel,
        includeIncompatible: true,
      });
      logger.info("No runtime extensions matched the query.");
      if (incompatibleResults.length > 0) {
        logger.info();
        logger.infoText`
          However, ${incompatibleResults.length} incompatible runtime extension(s) were found.
          Re-run with --allow-incompatible to see and download them.
        `;
      }
    }
    process.exit(0);
  }

  return searchResults;
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
    const latestLocalVersion = determineLatestLocalVersion(runtimeExtension.localVersions);
    return {
      name: runtimeExtension.name,
      version: runtimeExtension.version,
      latestLocalVersion: formatLatestLocalVersion(latestLocalVersion),
      status: formatRuntimeUpdateStatus(runtimeExtension.version, latestLocalVersion),
    };
  });

  const table = columnify(rows, {
    columns: ["name", "latestLocalVersion", "version", "status"],
    config: {
      name: {
        headingTransform: () => "NAME",
        align: "left",
      },
      latestLocalVersion: {
        headingTransform: () => "LATEST LOCAL",
        align: "left",
      },
      version: {
        headingTransform: () => "AVAILABLE",
        align: "left",
      },
      status: {
        headingTransform: () => "",
        align: "left",
      },
    },
    columnSplitter: "    ",
  });

  logger.info(table);
}

async function selectRuntimeExtensionToDownload(
  logger: SimpleLogger,
  runtimeExtensions: Array<DownloadableRuntimeExtensionInfo>,
  options: RuntimeGetCommandOpts,
): Promise<DownloadableRuntimeExtensionInfo> {
  if (runtimeExtensions.length === 1) {
    return runtimeExtensions[0];
  }

  if (options.yes === true) {
    logger.warnText`
      Multiple runtime extensions matched the query. Selecting the first result because --yes was
      provided.
    `;
    return runtimeExtensions[0];
  }

  const isStdoutInteractive = process.stdout.isTTY === true;
  const isStdinInteractive = process.stdin.isTTY === true;
  if (isStdoutInteractive === true && isStdinInteractive === true) {
    const promptChoices = runtimeExtensions.map(runtimeExtension => {
      const latestLocalVersion = determineLatestLocalVersion(runtimeExtension.localVersions);
      const remoteVersion = runtimeExtension.version;

      let latestLocalDescriptor: string;

      if (latestLocalVersion === undefined) {
        latestLocalDescriptor = "No local version";
      } else if (runtimeExtension.localVersions.includes(remoteVersion)) {
        if (latestLocalVersion === remoteVersion) {
          latestLocalDescriptor = "Up-to-date";
        } else {
          latestLocalDescriptor = "Same version installed";
        }
      } else {
        const versionComparison = compareVersions(runtimeExtension.version, latestLocalVersion);
        if (versionComparison < 0) {
          latestLocalDescriptor = `Downgrade available: ${latestLocalVersion} -> ${remoteVersion}`;
        } else if (versionComparison > 0) {
          latestLocalDescriptor = `Update available: ${latestLocalVersion} -> ${remoteVersion}`;
        } else {
          // Should not happen as this is handled in the previous branch
          latestLocalDescriptor = "Up-to-date";
        }
      }
      return {
        name: `${runtimeExtension.name}@${runtimeExtension.version} (${latestLocalDescriptor})`,
        value: runtimeExtension,
      };
    });

    return await runPromptWithExitHandling(() =>
      select<DownloadableRuntimeExtensionInfo>(
        {
          message: "Multiple runtime extensions matched the query. Select one to download:",
          choices: promptChoices,
        },
        { output: process.stderr },
      ),
    );
  }

  logger.errorText`
    Multiple runtime extensions matched the query. Re-run with a more specific query or use -l to
    list all matches.
  `;
  process.exit(1);
}

async function downloadRuntimeExtension(
  logger: SimpleLogger,
  client: LMStudioClient,
  runtimeExtension: DownloadableRuntimeExtensionInfo,
) {
  logger.info(`Download ${runtimeExtension.name}@${runtimeExtension.version}...`);
  const downloadResult: DownloadRuntimeExtensionResult =
    await downloadRuntimeExtensionWithErrorHandling(logger, client, runtimeExtension, {
      updateSelections: true,
    });
  if (downloadResult === "downloaded") {
    logger.info("Select the runtime using:");
    logger.info();
    logger.info(`  lms runtime select ${runtimeExtension.name}@${runtimeExtension.version}`);
  }
}

const getCommand = new Command<[], RuntimeGetCommandOptions>()
  .name("get")
  .description("Download or list runtime extensions.")
  .argument(
    "[query]",
    "Query runtime extensions. Examples: 'llama.cpp', 'llama.cpp:cuda', 'llama.cpp@1.2.3'",
  )
  .option("-l, --list", "List runtime extensions without downloading")
  .option(
    "--allow-incompatible",
    "Include runtime extensions that are incompatible with your system",
  )
  .addOption(
    new Option(
      "--channel <channel>",
      "Override the runtime extension channel to query from (examples: stable, beta)",
    ),
  )
  .option("-y, --yes", "Automatically pick the first result when multiple matches are found")
  .action(async function (queryArgument: string | undefined) {
    const options = this.optsWithGlobals();
    const logger = createLogger(options);
    await using client = await createClient(logger, options);

    const runtimeGetOptions: RuntimeGetCommandOpts = {
      allowIncompatible: options.allowIncompatible ?? false,
      channel: options.channel,
      list: options.list ?? false,
      yes: options.yes ?? false,
    };

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

    const runtimeExtension = await selectRuntimeExtensionToDownload(
      logger,
      runtimeExtensions,
      runtimeGetOptions,
    );
    await downloadRuntimeExtension(logger, client, runtimeExtension);
  });

addCreateClientOptions(getCommand);
addLogLevelOptions(getCommand);

export const get = getCommand;
