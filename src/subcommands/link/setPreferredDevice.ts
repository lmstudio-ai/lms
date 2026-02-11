import { Command } from "@commander-js/extra-typings";
import { select } from "@inquirer/prompts";
import { text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { runPromptWithExitHandling } from "../../prompt.js";
import { type LinkCommandOptions } from "./shared.js";

interface PreferredDeviceOption {
  deviceIdentifier: string;
  deviceName: string;
  kind: "local" | "peer";
  statusLabel: string | null;
}

export const setPreferredDevice = new Command<[], LinkCommandOptions>()
  .name("set-preferred-device")
  .description("Set the preferred LM Link device for model resolution")
  .argument("[deviceIdentifier]", "Device identifier to set as preferred");

addCreateClientOptions(setPreferredDevice);
addLogLevelOptions(setPreferredDevice);

setPreferredDevice.action(
  async (deviceIdentifierArgument: string | undefined, options: LinkCommandOptions) => {
    const logger = createLogger(options);
    await using client = await createClient(logger, options);

    const lmLinkStatus = await client.repository.lmLink.status();

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

    const preferredDeviceIdentifier = lmLinkStatus.preferredDeviceIdentifier;

    const deviceOptions: Array<PreferredDeviceOption> = [];

    if (lmLinkStatus.deviceIdentifier !== null) {
      deviceOptions.push({
        deviceIdentifier: lmLinkStatus.deviceIdentifier,
        deviceName: lmLinkStatus.deviceName,
        kind: "local",
        statusLabel: null,
      });
    }

    for (const peer of lmLinkStatus.peers) {
      deviceOptions.push({
        deviceIdentifier: peer.deviceIdentifier,
        deviceName: peer.deviceName,
        kind: "peer",
        statusLabel: peer.status,
      });
    }

    if (deviceOptions.length === 0) {
      logger.error("No devices are available to set as preferred.");
      return;
    }

    const resolvedIdentifier =
      deviceIdentifierArgument === undefined
        ? await promptForDeviceIdentifier({
            deviceOptions,
            preferredDeviceIdentifier,
          })
        : deviceIdentifierArgument;

    if (resolvedIdentifier === null) {
      return;
    }

    const matchingOption = deviceOptions.find(
      option => option.deviceIdentifier === resolvedIdentifier,
    );

    if (matchingOption === undefined) {
      logger.error(`Unknown device identifier "${resolvedIdentifier}".`);
      logger.info("Available device identifiers:");
      for (const option of deviceOptions) {
        logger.info(`  - ${option.deviceIdentifier} (${option.deviceName})`);
      }
      return;
    }

    await client.repository.lmLink.setPreferredDevice(matchingOption.deviceIdentifier);

    logger.info(
      `Updated preferred device to "${matchingOption.deviceName}" (${matchingOption.deviceIdentifier}).`,
    );

  if (lmLinkStatus.issues.includes("deviceDisabled") === true) {
      logger.infoText`
      Note: LM Link is disabled. Run ${chalk.cyan("lms link enable")} to enable it.
    `;
    }
  },
);

interface PromptForDeviceIdentifierOpts {
  deviceOptions: Array<PreferredDeviceOption>;
  preferredDeviceIdentifier: string | undefined;
}

async function promptForDeviceIdentifier({
  deviceOptions,
  preferredDeviceIdentifier,
}: PromptForDeviceIdentifierOpts): Promise<string | null> {
  const isStdoutInteractive = process.stdout.isTTY === true;
  const isStdinInteractive = process.stdin.isTTY === true;
  if (isStdoutInteractive === false || isStdinInteractive === false) {
    console.info(text`
      Cannot prompt for a preferred device in a non-interactive environment.
      Re-run with a device identifier argument.
    `);
    return null;
  }

  const pageSize = terminalSize().rows - 4;

  return await runPromptWithExitHandling(() =>
    select<string>(
      {
        message: chalk.green("Select a preferred device") + chalk.dim(" |"),
        loop: false,
        pageSize,
        choices: deviceOptions.map(option => {
          let label = option.deviceName;
          if (option.kind === "local") {
            label += chalk.dim(" (this device)");
          }
          if (option.statusLabel !== null) {
            label += chalk.dim(` (${option.statusLabel})`);
          }
          if (
            preferredDeviceIdentifier !== undefined &&
            preferredDeviceIdentifier === option.deviceIdentifier
          ) {
            label += chalk.green(" (preferred)");
          }
          return {
            name: label,
            value: option.deviceIdentifier,
          };
        }),
      },
      { output: process.stderr },
    ),
  );
}
