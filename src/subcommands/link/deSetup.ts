import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";

type DeSetupCommandOptions = OptionValues & LogLevelArgs;

const deSetupCommand = new Command<[], DeSetupCommandOptions>()
  .name("de-setup")
  .description(text`Remove compute-device setup from this machine`);

addLogLevelOptions(deSetupCommand);

deSetupCommand.action(async (options: DeSetupCommandOptions) => {
  const logger = createLogger(options);
  await using client = await createClient(logger);
  await client.repository.lmLink.unstable_deSetupComputeDevice();
});

export const deSetup = deSetupCommand;
