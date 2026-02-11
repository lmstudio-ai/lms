import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type LinkCommandOptions } from "./shared.js";

export const disable = new Command<[], LinkCommandOptions>()
  .name("disable")
  .description("Disable LM Link on this device");

addCreateClientOptions(disable);
addLogLevelOptions(disable);

disable.action(async function () {
  const mergedOptions = this.optsWithGlobals();
  const logger = createLogger(mergedOptions);
  await using client = await createClient(logger, mergedOptions);

  const currentStatus = await client.repository.lmLink.status();
  const wasAlreadyDisabled: boolean = currentStatus.issues.includes("deviceDisabled") === true;

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
