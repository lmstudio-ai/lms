import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type LinkCommandOptions, startLinkLoader } from "./shared.js";

export const enable = new Command<[], LinkCommandOptions>()
  .name("enable")
  .description("Enable LM Link on this device");

addCreateClientOptions(enable);
addLogLevelOptions(enable);

enable.action(async function () {
  const mergedOptions = this.optsWithGlobals();
  const logger = createLogger(mergedOptions);
  await using client = await createClient(logger, mergedOptions);

  const currentStatus = await client.repository.lmLink.status();
  const wasDisabled: boolean = currentStatus.issues.includes("deviceDisabled") === true;
  const stopLoader = startLinkLoader();
  try {
    await client.repository.lmLink.setDisabled(false);
  } finally {
    stopLoader();
  }

  if (wasDisabled === false) {
    logger.infoText`
      LM Link was already enabled on this device. Use ${chalk.cyan("lms link status")} to see its current status.
    `;
  } else {
    logger.infoText`
      You have re-enabled LM Link on this device. Use ${chalk.cyan("lms link status")} to see its current status.
    `;
  }
});
