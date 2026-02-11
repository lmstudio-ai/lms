import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type LinkCommandOptions } from "./shared.js";

export const setDeviceName = new Command<[], LinkCommandOptions>()
  .name("set-device-name")
  .description("Set the local LM Link device name")
  .argument("<name>", "New device name");

addCreateClientOptions(setDeviceName);
addLogLevelOptions(setDeviceName);

setDeviceName.action(async (name: string, options: LinkCommandOptions) => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);

  await client.repository.lmLink.updateDeviceName(name);

  logger.info(`Updated device name to "${name}".`);

  const lmLinkStatus = await client.repository.lmLink.status();
  if (lmLinkStatus.issues.includes("deviceDisabled") === true) {
    logger.infoText`
      Note: LM Link is disabled. Run ${chalk.cyan("lms link enable")} to enable it.
    `;
  }
});
