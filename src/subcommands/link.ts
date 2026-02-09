import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import chalk from "chalk";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";

type LinkUpCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

type LinkDownCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

type LinkStatusCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    json?: boolean;
  };

type LinkSetDeviceNameCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

const up = new Command<[], LinkUpCommandOptions>()
  .name("up")
  .description("Enable and start LM Link");

addCreateClientOptions(up);
addLogLevelOptions(up);

up.action(async function () {
  const mergedOptions = this.optsWithGlobals();
  const logger = createLogger(mergedOptions as LogLevelArgs);
  await using client = await createClient(logger, mergedOptions as CreateClientArgs & LogLevelArgs);

  // Check current status first
  const currentStatus = await client.repository.lmLink.status();

  let result;
  let wasAlreadyUp = false;

  if (currentStatus.enabled && currentStatus.status === "online") {
    // Already up
    wasAlreadyUp = true;
    result = { peers: currentStatus.peers };
  } else {
    // Start LM Link
    result = await client.repository.lmLink.up();
  }

  // Determine message based on previous state
  let message: string;
  if (wasAlreadyUp) {
    message = "LM Link was already up";
  } else if (currentStatus.enabled) {
    message = "LM Link reconnected successfully";
  } else {
    message = "LM Link started successfully";
  }

  logger.info(`This device: ${currentStatus.deviceName}`);
  logger.info("");

  // Display result
  if (result.peers.length === 0) {
    logger.info(`${message}. No devices found.`);
  } else {
    logger.info(
      `${message}. Found ${result.peers.length} device${result.peers.length === 1 ? "" : "s"}:`,
    );
    logger.info("");
    for (const peer of result.peers) {
      logger.info(`  - ${peer.deviceName}`);
    }
  }
});

const down = new Command<[], LinkDownCommandOptions>()
  .name("down")
  .description("Stop and disable LM Link");

addCreateClientOptions(down);
addLogLevelOptions(down);

down.action(async function () {
  const mergedOptions = this.optsWithGlobals();
  const logger = createLogger(mergedOptions as LogLevelArgs);
  await using client = await createClient(logger, mergedOptions as CreateClientArgs & LogLevelArgs);

  // Check current status first
  const currentStatus = await client.repository.lmLink.status();

  if (!currentStatus.enabled) {
    logger.info("LM Link was already disabled.");
    return;
  }

  // Stop LM Link
  await client.repository.lmLink.down();
  logger.info("LM Link has been stopped and disabled.");
});

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

  logger.info(`This device: ${lmLinkStatus.deviceName}`);
  logger.info("");

  // Human-readable output
  if (!lmLinkStatus.enabled) {
    logger.infoText`
      LM Link is currently disabled.

      Run ${chalk.cyan("lms link up")} to enable it.
    `;
    return;
  }

  if (lmLinkStatus.status !== "online") {
    logger.infoText`
      LM Link is enabled but currently disconnected.

      Use ${chalk.cyan("lms link up")} to reconnect.
    `;
    return;
  }

  // Enabled and connected
  const peerCount = lmLinkStatus.peers.length;
  logger.info(
    `LM Link is enabled and connected. Found ${peerCount} device${peerCount === 1 ? "" : "s"}:`,
  );
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
  if (lmLinkStatus.enabled !== true) {
    logger.info('Note: LM Link is not enabled. Run "lms link up" to start LM Link.');
  }
});

export const link = new Command()
  .name("link")
  .description("Commands for managing LM Link")
  .addCommand(up)
  .addCommand(down)
  .addCommand(status)
  .addCommand(setDeviceName);
