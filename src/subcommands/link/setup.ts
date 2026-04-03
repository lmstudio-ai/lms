import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";

type SetupCommandOptions = OptionValues & LogLevelArgs;

const setupCommand = new Command<[], SetupCommandOptions>()
  .name("setup")
  .description(text`Set up this machine as a compute device`)
  .argument(
    "<setup-code>",
    text`
      The compute-device setup code from LM Studio.
    `,
  );

addLogLevelOptions(setupCommand);

setupCommand.action(async (setupCode: string, options: SetupCommandOptions) => {
  const logger = createLogger(options);
  await using client = await createClient(logger);
  const result = await client.repository.lmLink.unstable_setupComputeDevice(setupCode);
  const ownerType = result.ownerIsOrganization ? "organization" : "user";
  logger.info(`Successfully setup as compute device for ${ownerType} ${result.ownerUsername}.`);
});

export const setup = setupCommand;
