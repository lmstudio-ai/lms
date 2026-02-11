import { Command } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type LinkStatusCommandOptions } from "./shared.js";

const statusDisplayLabels = new Map<string, string>([
  ["offline", "Offline (will attempt to reconnect)"],
  ["starting", "Connecting"],
  ["stopping", "Shutting down"],
  ["online", "Online"],
]);

export const status = new Command<[], LinkStatusCommandOptions>()
  .name("status")
  .description("Display the status of LM Link")
  .option(
    "--json",
    text`
      Outputs the status in JSON format to stdout.
    `,
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
    logger.infoText`
      You have disabled LM Link. To re-enable it, run ${chalk.cyan("lms link enable")}.
    `;
    return;
  }

  if (lmLinkStatus.issues.includes("notLoggedIn") === true) {
    logger.infoText`
      LM Link not running because you are not logged in. Use ${chalk.cyan("lms login")} to login.
    `;
    return;
  }

  if (lmLinkStatus.issues.includes("noAccess") === true) {
    logger.infoText`
      You do not have access to LM Link. Visit ${chalk.cyan("https://lmstudio.ai/lm-link")} to request access.
    `;
    return;
  }

  // No issues — print status + device name + peers
  const statusLabel = statusDisplayLabels.get(lmLinkStatus.status) ?? lmLinkStatus.status;

  logger.info(`This device: ${lmLinkStatus.deviceName}`);
  logger.info(`Status: ${statusLabel}`);
  logger.info("");

  if (lmLinkStatus.status !== "online") {
    return;
  }

  const peerCount = lmLinkStatus.peers.length;
  logger.info(`Found ${peerCount} device${peerCount === 1 ? "" : "s"}:`);
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
    logger.info(`    Status: ${peer.status}`);
    logger.info(`    Identifier: ${peer.deviceIdentifier}`);

    // Filter models for this peer
    const peerModels = modelInfos.filter(
      modelInfo => modelInfo.deviceIdentifier === peer.deviceIdentifier,
    );

    if (peerModels.length > 0) {
      logger.info("    Loaded Models Instances:");
      const displayCount = Math.min(5, peerModels.length);
      for (let index = 0; index < displayCount; index++) {
        logger.info(`      - ${peerModels[index].identifier}`);
      }
      if (peerModels.length > 5) {
        const remaining = peerModels.length - 5;
        logger.info(`      ... (and ${remaining} more)`);
      }
    }
  }

  logger.info("");
});
