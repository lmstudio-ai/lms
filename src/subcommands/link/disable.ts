import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { t } from "../../i18n/index.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type LinkCommandOptions } from "./shared.js";
import { text } from "@lmstudio/lms-common";

export const disable = new Command<[], LinkCommandOptions>()
  .name("disable")
  .description(t("Disable LM Link on this device"));

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
    logger.info(
      t(
        text`
      LM Link was already disabled on this device. No changes were made. Use {p0} to re-enable.
    `,
        { p0: chalk.cyan("lms link enable") },
      ),
    );
  } else {
    logger.info(
      t(
        text`
      You have disabled LM Link on this device. Use {p0} to re-enable.
    `,
        { p0: chalk.cyan("lms link enable") },
      ),
    );
  }
});
