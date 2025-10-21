import { Command, Option } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { type DownloadableRuntimeExtensionInfo } from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import columnify from "columnify";
import { askQuestion } from "../../confirm.js";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import {
  buildRuntimeExtensionsSearchOptions,
  determineLatestLocalVersion,
  downloadRuntimeExtensionWithHandling,
  formatLatestLocalVersion,
  type DownloadRuntimeExtensionResult,
  type RuntimeExtensionsSearchOptions,
} from "./helpers/runtimeExtensions.js";

interface RuntimeUpdateCommandOptions {
  all: boolean;
  allowIncompatible: boolean;
  channel?: "stable" | "beta";
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

  const table = columnify(rows, {
    columns: ["name", "current", "target"],
    config: {
      name: {
        headingTransform: () => "NAME",
        align: "left",
      },
      current: {
        headingTransform: () => "CURRENT",
        align: "left",
      },
      target: {
        headingTransform: () => "TARGET",
        align: "left",
      },
    },
    columnSplitter: "    ",
  });
  logger.info(table);
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
      "Cannot prompt for confirmation in a non-interactive environment. Re-run with --yes.",
    );
    return "cannot-confirm";
  }

  const userConfirmed = await askQuestion("Continue updating runtime extensions?");
  if (userConfirmed === false) {
    logger.info("Update cancelled.");
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
      "Updating " +
        runtimeExtension.name +
        " from " +
        updateCandidate.latestLocalVersion +
        " to " +
        runtimeExtension.version +
        "...",
    );
    const downloadResult: DownloadRuntimeExtensionResult =
      await downloadRuntimeExtensionWithHandling(logger, client, runtimeExtension);
    if (downloadResult === "downloaded") {
      logger.info(
        "Updated " + runtimeExtension.name + " to version " + runtimeExtension.version + ".",
      );
    }
  }
}

async function runtimeUpdateAction(
  logger: SimpleLogger,
  client: LMStudioClient,
  queryArgument: string | undefined,
  commandOptions: RuntimeUpdateCommandOptions,
): Promise<void> {
  const searchQuery = queryArgument ?? "";
  const searchOptions: RuntimeExtensionsSearchOptions = buildRuntimeExtensionsSearchOptions(
    commandOptions.channel,
    commandOptions.allowIncompatible,
  );
  const allRuntimeExtensions = await client.runtime.extensions.search(
    searchQuery,
    searchOptions,
  );

  if (allRuntimeExtensions.length === 0) {
    logger.info("No runtime extensions matched the query.");
    return;
  }

  const latestRuntimeExtensions = selectLatestRuntimeExtensions(allRuntimeExtensions);
  const selectedRuntimeNames =
    commandOptions.all === true ? undefined : await getSelectedRuntimeNames(client);
  const updateCandidates = prepareUpdateCandidates(
    latestRuntimeExtensions,
    commandOptions.all,
    selectedRuntimeNames,
  );

  if (updateCandidates.length === 0) {
    logger.info("All matching runtime extensions are already up to date.");
    return;
  }

  renderUpdatePlan(logger, updateCandidates);

  if (commandOptions.dryRun === true) {
    return;
  }

  const confirmationResult = await confirmUpdate(logger, commandOptions.yes);
  if (confirmationResult === "declined") {
    return;
  }
  if (confirmationResult === "cannot-confirm") {
    process.exit(1);
  }

  await performUpdates(logger, client, updateCandidates);
}

export const update = addLogLevelOptions(
  addCreateClientOptions(
    new Command().name("update").description("Update installed runtime extensions."),
  )
    .argument("[query]", "Filter runtime extensions by name, version, platform, or hardware filters")
    .option("-a, --all", "Update all installed runtime extensions")
    .option("--allow-incompatible", "Include runtime extensions that are incompatible")
    .addOption(
      new Option("--channel <channel>", "Override the runtime extension channel to query from").choices(
        ["stable", "beta"],
      ),
    )
    .option("--dry-run", "Show extensions that would be updated without performing downloads")
    .option("-y, --yes", "Skip confirmation prompts")
    .action(async function (queryArgument: string | undefined, options) {
      const parentOptions = this.parent?.opts() ?? {};
      const logger = createLogger(parentOptions);
      const client = await createClient(logger, parentOptions);

      const runtimeUpdateOptions = options as RuntimeUpdateCommandOptions;
      await runtimeUpdateAction(logger, client, queryArgument, runtimeUpdateOptions);
    }),
);
