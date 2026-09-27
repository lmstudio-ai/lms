import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { t } from "../../i18n/index.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type LinkCommandOptions } from "./shared.js";
import { text } from "@lmstudio/lms-common";

export const setDeviceName = new Command<[], LinkCommandOptions>()
  .name("set-device-name")
  .description(t("Set the local LM Link device name"))
  .argument("<name>", t("New device name"));

addCreateClientOptions(setDeviceName);
addLogLevelOptions(setDeviceName);

setDeviceName.action(async (name: string, options: LinkCommandOptions) => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);

  await client.repository.lmLink.updateDeviceName(name);

  logger.info(t(`Updated device name to "{p0}".`, { p0: name }));

  const lmLinkStatus = await client.repository.lmLink.status();
  if (lmLinkStatus.issues.includes("deviceDisabled") === true) {
    logger.info(
      t(
        text`
      Note: LM Link is disabled. Run {p0} to enable it.
    `,
        { p0: chalk.cyan("lms link enable") },
      ),
    );
  }
});
