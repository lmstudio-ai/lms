import { Command } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { t } from "../../i18n/index.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type LinkStatusCommandOptions } from "./shared.js";

const statusDisplayLabels = new Map<string, string>([
  ["offline", t("Offline (will attempt to reconnect)")],
  ["starting", "Connecting"],
  ["stopping", t("Shutting down")],
  ["online", "Online"],
]);

export const status = new Command<[], LinkStatusCommandOptions>()
  .name("status")
  .description(t("Display the status of LM Link"))
  .option(
    "--json",
    t(text`
      Outputs the status in JSON format to stdout.
    `),
  );

addCreateClientOptions(status);
addLogLevelOptions(status);

status.action(async function () {
  const mergedOptions = this.optsWithGlobals();
  const logger = createLogger(mergedOptions);
  await using client = await createClient(logger, mergedOptions);
  const { json = false } = mergedOptions;

  const lmLinkStatus = await client.repository.lmLink.status();

  if (json) {
    // Get loaded models for JSON output
    const loadedModels = [
      ...(await client.llm.listLoaded()),
      ...(await client.embedding.listLoaded()),
    ];

    // Get model info for each loaded model
    const modelInfos = await Promise.all(
      loadedModels.map(async model => {
        const info = await model.getModelInfo();
        return {
          identifier: model.identifier,
          deviceIdentifier: info.deviceIdentifier,
        };
      }),
    );

    // Build JSON output with loaded models per peer
    const peersWithModels = lmLinkStatus.peers.map(peer => ({
      ...peer,
      loadedModels: modelInfos
        .filter(modelInfo => modelInfo.deviceIdentifier === peer.deviceIdentifier)
        .map(modelInfo => modelInfo.identifier),
    }));

    const jsonOutput = {
      ...lmLinkStatus,
      peers: peersWithModels,
    };

    console.info(JSON.stringify(jsonOutput));
    return;
  }

  // Human-readable output: check issues in priority order
  if (lmLinkStatus.issues.includes("deviceDisabled") === true) {
    logger.info(
      t(
        text`
      You have disabled LM Link. To re-enable it, run {p0}.
    `,
        { p0: chalk.cyan("lms link enable") },
      ),
    );
    return;
  }

  if (lmLinkStatus.issues.includes("notLoggedIn") === true) {
    logger.info(
      t(
        text`
      LM Link not running because you are not logged in. Use {p0} to login.
    `,
        { p0: chalk.cyan("lms login") },
      ),
    );
    return;
  }

  if (lmLinkStatus.issues.includes("noAccess") === true) {
    logger.info(
      t(
        text`
      You do not have access to LM Link. Visit {p0} to
      request access.
    `,
        { p0: chalk.cyan("https://lmstudio.ai/lm-link") },
      ),
    );
    return;
  }

  if (lmLinkStatus.issues.includes("badVersion") === true) {
    const { isDaemon } = await client.system.getInfo();
    logger.info(
      t(
        text`
      LM Link cannot connect because the protocol has updated. You need to update
      {p0} to continue using LM Link.
    `,
        { p0: isDaemon ? "llmster" : "LM Studio" },
      ),
    );
    if (isDaemon) {
      logger.info(
        t(
          text`
        Run {p0} to update.
      `,
          { p0: chalk.cyan("lms daemon update") },
        ),
      );
    }
    return;
  }

  // No issues — print status + device name + peers
  const statusLabel = statusDisplayLabels.get(lmLinkStatus.status) ?? lmLinkStatus.status;

  const lastError = lmLinkStatus.lastError;
  if (lmLinkStatus.status === "offline" && lastError !== undefined) {
    const reconnectInSeconds = lmLinkStatus.reconnectInSeconds;
    let offlineStatusLabel = "Offline";
    if (reconnectInSeconds !== undefined) {
      offlineStatusLabel = t(`Offline (Reconnect in {p0}s)`, { p0: reconnectInSeconds });
    }
    const secondsSinceError = Math.max(0, Math.floor((Date.now() - lastError.timestamp) / 1000));
    logger.info(t(`This device: {p0}`, { p0: lmLinkStatus.deviceName }));
    logger.info(t(`Status: {p0}`, { p0: offlineStatusLabel }));
    logger.info(
      t(`Last error: {p0} ({p1}s ago)`, { p0: lastError.message, p1: secondsSinceError }),
    );
    return;
  }

  logger.info(t(`This device: {p0}`, { p0: lmLinkStatus.deviceName }));
  logger.info(t(`Status: {p0}`, { p0: statusLabel }));

  if (lmLinkStatus.status !== "online") {
    return;
  }
  logger.info("");

  const peerCount = lmLinkStatus.peers.length;
  logger.info(t(`Found {p0} device{p1}:`, { p0: peerCount, p1: peerCount === 1 ? "" : "s" }));

  if (peerCount === 0) {
    return;
  }
  logger.info("");

  // Get loaded models to display per peer
  const loadedModels = [
    ...(await client.llm.listLoaded()),
    ...(await client.embedding.listLoaded()),
  ];

  const modelInfos = await Promise.all(
    loadedModels.map(async model => {
      const info = await model.getModelInfo();
      return {
        identifier: model.identifier,
        deviceIdentifier: info.deviceIdentifier,
      };
    }),
  );

  for (const peer of lmLinkStatus.peers) {
    logger.info(`  - ${peer.deviceName}`);
    logger.info(t(`    Status: {p0}`, { p0: peer.status }));
    logger.info(t(`    Identifier: {p0}`, { p0: peer.deviceIdentifier }));

    // Filter models for this peer
    const peerModels = modelInfos.filter(
      modelInfo => modelInfo.deviceIdentifier === peer.deviceIdentifier,
    );

    if (peerModels.length > 0) {
      logger.info(t("    Loaded Models Instances:"));
      const displayCount = Math.min(5, peerModels.length);
      for (let index = 0; index < displayCount; index++) {
        logger.info(`      - ${peerModels[index].identifier}`);
      }
      if (peerModels.length > 5) {
        const remaining = peerModels.length - 5;
        logger.info(t(`      ... (and {p0} more)`, { p0: remaining }));
      }
    }
  }
});
