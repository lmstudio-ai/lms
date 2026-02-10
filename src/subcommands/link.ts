import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import chalk from "chalk";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";

type LinkEnableCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

type LinkDisableCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

type LinkStatusCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    json?: boolean;
  };

type LinkSetDeviceNameCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;
const linkLoaderFrames = ["● ○ ○ ○", "○ ● ○ ○", "○ ○ ● ○", "○ ○ ○ ●", "○ ○ ● ○", "○ ● ○ ○"];

const startLinkLoader = (intervalMs = 120) => {
  let frameIndex = 0;
  const timer = setInterval(() => {
    const frame = linkLoaderFrames[frameIndex];
    frameIndex = (frameIndex + 1) % linkLoaderFrames.length;
    process.stdout.write(`\r${frame}`);
  }, intervalMs);

  return () => {
    clearInterval(timer);
    // Clear the loader line from the terminal
    process.stdout.write("\r\x1B[K");
  };
};
const enable = new Command<[], LinkEnableCommandOptions>()
  .name("enable")
  .description("Enable LM Link on this device");

addCreateClientOptions(enable);
addLogLevelOptions(enable);

enable.action(async function () {
  const mergedOptions = this.optsWithGlobals();
  const logger = createLogger(mergedOptions as LogLevelArgs);
  await using client = await createClient(logger, mergedOptions as CreateClientArgs & LogLevelArgs);

  const currentStatus = await client.repository.lmLink.status();
  const wasDisabled: boolean = currentStatus.issues.includes("deviceDisabled");
  const stopLoader = startLinkLoader();
  try {
    await client.repository.lmLink.setDisabled(false);
  } finally {
    stopLoader();
  }

  if (!wasDisabled) {
    logger.infoText`
      LM Link was already enabled on this device. Use ${chalk.cyan("lms link status")} to see its current status.
    `;
  } else {
    logger.infoText`
      You have re-enabled LM Link on this device. Use ${chalk.cyan("lms link status")} to see its current status.
    `;
  }
});

const disable = new Command<[], LinkDisableCommandOptions>()
  .name("disable")
  .description("Disable LM Link on this device");

addCreateClientOptions(disable);
addLogLevelOptions(disable);

disable.action(async function () {
  const mergedOptions = this.optsWithGlobals();
  const logger = createLogger(mergedOptions as LogLevelArgs);
  await using client = await createClient(logger, mergedOptions as CreateClientArgs & LogLevelArgs);

  const currentStatus = await client.repository.lmLink.status();
  const wasAlreadyDisabled: boolean = currentStatus.issues.includes("deviceDisabled");

  await client.repository.lmLink.setDisabled(true);

  if (wasAlreadyDisabled) {
    logger.infoText`
      LM Link was already disabled on this device. No changes were made. Use ${chalk.cyan("lms link enable")} to re-enable.
    `;
  } else {
    logger.infoText`
      You have disabled LM Link on this device. Use ${chalk.cyan("lms link enable")} to re-enable.
    `;
  }
});

const statusDisplayLabels = new Map<string, string>([
  ["offline", "Offline (will attempt to reconnect)"],
  ["starting", "Connecting"],
  ["stopping", "Shutting down"],
  ["online", "Online"],
]);

const status = new Command<[], LinkStatusCommandOptions>()
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
  const logger = createLogger(mergedOptions as LogLevelArgs);
  await using client = await createClient(logger, mergedOptions as CreateClientArgs & LogLevelArgs);
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
  if (lmLinkStatus.issues.includes("deviceDisabled")) {
    logger.infoText`
      You have disabled LM Link. To re-enable it, run ${chalk.cyan("lms link enable")}.
    `;
    return;
  }

  if (lmLinkStatus.issues.includes("notLoggedIn")) {
    logger.infoText`
      LM Link not running because you are not logged in. Use ${chalk.cyan("lms login")} to login.
    `;
    return;
  }

  if (lmLinkStatus.issues.includes("noAccess")) {
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

const setDeviceName = new Command<[], LinkSetDeviceNameCommandOptions>()
  .name("set-device-name")
  .description("Set the local LM Link device name")
  .argument("<name>", "New device name");

addCreateClientOptions(setDeviceName);
addLogLevelOptions(setDeviceName);

setDeviceName.action(async (name: string, options: LinkSetDeviceNameCommandOptions) => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);

  await client.repository.lmLink.updateDeviceName(name);

  logger.info(`Updated device name to "${name}".`);

  const lmLinkStatus = await client.repository.lmLink.status();
  if (lmLinkStatus.issues.includes("deviceDisabled")) {
    logger.infoText`
      Note: LM Link is disabled. Run ${chalk.cyan("lms link enable")} to enable it.
    `;
  }
});

export const link = new Command()
  .name("link")
  .description("Commands for managing LM Link")
  .addCommand(enable)
  .addCommand(disable)
  .addCommand(status)
  .addCommand(setDeviceName);
