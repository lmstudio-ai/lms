import { Command, Option } from "@commander-js/extra-typings";
import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { type DownloadableRuntimeExtensionInfo } from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import { compareVersions } from "../../compareVersions.js";
import { askQuestion } from "../../confirm.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../../createClient.js";
import { t } from "../../i18n/index.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import {
  determineLatestLocalVersion,
  downloadRuntimeExtensionWithErrorHandling,
  formatLatestLocalVersion,
  type DownloadRuntimeExtensionResult,
} from "./helpers/runtimeExtensionDownload.js";

interface RuntimeUpdateCommandOpts {
  all: boolean;
  allowIncompatible: boolean;
  channel?: string;
  dryRun: boolean;
  yes: boolean;
}

interface RuntimeUpdateCandidate {
  runtimeExtension: DownloadableRuntimeExtensionInfo;
  latestLocalVersion: string;
}

function selectLatestRuntimeExtensions(
  runtimeExtensions: Array<DownloadableRuntimeExtensionInfo>,
): Array<DownloadableRuntimeExtensionInfo> {
  const latestRuntimeExtensionMap = new Map<string, DownloadableRuntimeExtensionInfo>();
  for (const runtimeExtension of runtimeExtensions) {
    const runtimeKey = runtimeExtension.package + "::" + runtimeExtension.name;
    const existingRuntimeExtension = latestRuntimeExtensionMap.get(runtimeKey);
    if (existingRuntimeExtension === undefined) {
      latestRuntimeExtensionMap.set(runtimeKey, runtimeExtension);
      continue;
    }
    if (compareVersions(runtimeExtension.version, existingRuntimeExtension.version) === 1) {
      latestRuntimeExtensionMap.set(runtimeKey, runtimeExtension);
    }
  }
  return Array.from(latestRuntimeExtensionMap.values());
}

async function getSelectedRuntimeNames(client: LMStudioClient): Promise<Set<string>> {
  const selections = await client.runtime.engine.getSelections();
  const selectedRuntimeNames = new Set<string>();
  for (const runtimeEngineSpecifier of selections.values()) {
    selectedRuntimeNames.add(runtimeEngineSpecifier.name);
  }
  return selectedRuntimeNames;
}

function prepareUpdateCandidates(
  runtimeExtensions: Array<DownloadableRuntimeExtensionInfo>,
  updateAll: boolean,
  selectedRuntimeNames: Set<string> | undefined,
): Array<RuntimeUpdateCandidate> {
  const installedRuntimeExtensions = runtimeExtensions.filter(runtimeExtension => {
    return runtimeExtension.localVersions.length > 0;
  });

  const relevantRuntimeExtensions = installedRuntimeExtensions.filter(runtimeExtension => {
    if (updateAll === true) {
      return true;
    }
    if (selectedRuntimeNames === undefined) {
      return false;
    }
    return selectedRuntimeNames.has(runtimeExtension.name);
  });

  const updateCandidates: Array<RuntimeUpdateCandidate> = [];
  for (const runtimeExtension of relevantRuntimeExtensions) {
    const latestLocalVersion = determineLatestLocalVersion(runtimeExtension.localVersions);
    if (latestLocalVersion === undefined) {
      continue;
    }
    const needsUpdate = compareVersions(runtimeExtension.version, latestLocalVersion) === 1;
    if (needsUpdate === false) {
      continue;
    }
    updateCandidates.push({
      runtimeExtension,
      latestLocalVersion,
    });
  }

  return updateCandidates;
}

function renderUpdatePlan(
  logger: SimpleLogger,
  updateCandidates: Array<RuntimeUpdateCandidate>,
): void {
  const rows = updateCandidates.map(updateCandidate => {
    return {
      name: updateCandidate.runtimeExtension.name,
      current: formatLatestLocalVersion(updateCandidate.latestLocalVersion),
      target: updateCandidate.runtimeExtension.version,
    };
  });

  logger.info(t("Update Plan:"));
  logger.info();
  const longestName = Math.max(...rows.map(row => row.name.length));
  const nameWidth = longestName + 4;
  for (const row of rows) {
    logger.info(`  ${row.name.padEnd(nameWidth)}${row.current} → ${chalk.yellow(row.target)}`);
  }
  logger.info();
}

type ConfirmationResult = "confirmed" | "declined" | "cannot-confirm";

async function confirmUpdate(
  logger: SimpleLogger,
  skipConfirmation: boolean,
): Promise<ConfirmationResult> {
  if (skipConfirmation === true) {
    return "confirmed";
  }

  const isStdoutInteractive = process.stdout.isTTY === true;
  const isStdinInteractive = process.stdin.isTTY === true;
  if (isStdoutInteractive === false || isStdinInteractive === false) {
    logger.error(
      t("Cannot prompt for confirmation in a non-interactive environment. Re-run with --yes."),
    );
    return "cannot-confirm";
  }

  const userConfirmed = await askQuestion("Continue updating runtime extensions?");
  if (userConfirmed === false) {
    logger.info(t("Update cancelled."));
    return "declined";
  }
  return "confirmed";
}

async function performUpdates(
  logger: SimpleLogger,
  client: LMStudioClient,
  updateCandidates: Array<RuntimeUpdateCandidate>,
): Promise<void> {
  for (const updateCandidate of updateCandidates) {
    const runtimeExtension = updateCandidate.runtimeExtension;
    logger.info(
      t(
        text`
      Updating {p0} from {p1}
      to {p2}...
    `,
        {
          p0: runtimeExtension.name,
          p1: updateCandidate.latestLocalVersion,
          p2: runtimeExtension.version,
        },
      ),
    );
    const downloadResult: DownloadRuntimeExtensionResult =
      await downloadRuntimeExtensionWithErrorHandling(logger, client, runtimeExtension, {
        updateSelections: true,
      });
    if (downloadResult === "downloaded") {
      logger.info(
        t("Updated {name} to version {version}.", {
          name: runtimeExtension.name,
          version: runtimeExtension.version,
        }),
      );
    }
  }
}

async function runtimeUpdateAction(
  logger: SimpleLogger,
  client: LMStudioClient,
  queryArgument: string | undefined,
  opts: RuntimeUpdateCommandOpts,
): Promise<void> {
  const searchQuery = queryArgument ?? "";
  const hasQueryArgument = queryArgument !== undefined && queryArgument.length > 0;

  if (opts.all === true) {
    logger.info(t("Checking updates for all installed runtime extensions..."));
  } else if (hasQueryArgument === true) {
    // Don't log anything here; the query is already specified.
  } else {
    logger.info(
      t(
        "Checking updates for selected installed runtime extensions... (Pass --all to include all)",
      ),
    );
  }

  const allRuntimeExtensions = await client.runtime.extensions.search(searchQuery, {
    channel: opts.channel,
    includeIncompatible: opts.allowIncompatible,
  });

  if (allRuntimeExtensions.length === 0) {
    logger.info(t("No runtime extensions matched the query."));
    return;
  }

  const latestRuntimeExtensions = selectLatestRuntimeExtensions(allRuntimeExtensions);
  const selectedRuntimeNames =
    opts.all === true ? undefined : await getSelectedRuntimeNames(client);
  const updateCandidates = prepareUpdateCandidates(
    latestRuntimeExtensions,
    opts.all,
    selectedRuntimeNames,
  );

  if (updateCandidates.length === 0) {
    logger.info(t("All matching runtime extensions are already up-to-date."));
    return;
  }

  renderUpdatePlan(logger, updateCandidates);

  if (opts.dryRun === true) {
    return;
  }

  const confirmationResult = await confirmUpdate(logger, opts.yes);
  if (confirmationResult === "declined") {
    return;
  }
  if (confirmationResult === "cannot-confirm") {
    process.exit(1);
  }

  await performUpdates(logger, client, updateCandidates);
}

const updateCommand = new Command()
  .name("update")
  .description(t("Update installed runtime extensions."))
  .argument(
    "[query]",
    t("Query runtime extensions. Examples: 'llama.cpp', 'llama.cpp:cuda', 'llama.cpp@1.2.3'"),
  )
  .option("-a, --all", t("Update all installed runtime extensions"))
  .option(
    "--allow-incompatible",
    t("Include runtime extensions that are incompatible with your system"),
  )
  .addOption(
    new Option(
      "--channel <channel>",
      t("Override the runtime extension channel to query from (examples: stable, beta)"),
    ),
  )
  .option("--dry-run", t("Show extensions that would be updated without performing downloads"))
  .option("-y, --yes", t("Skip confirmation prompts"))
  .action(async function (queryArgument: string | undefined) {
    const mergedOptions = this.optsWithGlobals();
    const logger = createLogger(mergedOptions as LogLevelArgs);
    await using client = await createClient(
      logger,
      mergedOptions as CreateClientArgs & LogLevelArgs,
    );

    await runtimeUpdateAction(logger, client, queryArgument, {
      all: mergedOptions.all ?? false,
      allowIncompatible: mergedOptions.allowIncompatible ?? false,
      channel: mergedOptions.channel,
      dryRun: mergedOptions.dryRun ?? false,
      yes: mergedOptions.yes ?? false,
    });
  });

addCreateClientOptions(updateCommand);
addLogLevelOptions(updateCommand);

export const update = updateCommand;
