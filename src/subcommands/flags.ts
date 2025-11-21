import {
  Argument,
  Command,
  InvalidArgumentError,
  type OptionValues,
} from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";

const trueFalseParser = (str: string): boolean => {
  str = str.trim().toLowerCase();
  if (str === "true") {
    return true;
  } else if (str === "false") {
    return false;
  }
  throw new InvalidArgumentError("Expected 'true' or 'false'");
};

type FlagsCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    json?: boolean;
  };

const flagsCommand = new Command<[], FlagsCommandOptions>()
  .name("flags")
  .description("Set or get experiment flags")
  .option(
    "--json",
    text`
      Outputs the result in JSON format to stdout.
    `,
  )
  .argument("[flag]", "The flag to set or get")
  .addArgument(new Argument("[value]", "The value to set the flag to").argParser(trueFalseParser));

addCreateClientOptions(flagsCommand);
addLogLevelOptions(flagsCommand);

flagsCommand.action(async (flag, value, options: FlagsCommandOptions) => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);
  const { json } = options;

  if (flag === undefined) {
    // User did not provide a flag, so we should show all flags.
    const flags = await client.system.unstable_getExperimentFlags();
    if (json === true) {
      console.info(JSON.stringify(flags));
      return;
    }
    if (flags.length === 0) {
      logger.error("No experiment flags are set.");
      return;
    }
    console.info("Enabled experiment flags:");
    for (const flag of flags) {
      console.info(flag);
    }
  } else if (value === undefined) {
    // User provided a flag, but no value, so we should show the value of the flag.
    const flags = await client.system.unstable_getExperimentFlags();
    if (json === true) {
      console.info(JSON.stringify(flags.includes(flag)));
      return;
    }
    if (flags.includes(flag)) {
      console.info(`Flag "${flag}" is currently enabled.`);
    } else {
      console.info(`Flag "${flag}" is currently disabled.`);
    }
  } else {
    // User provided a flag and a value, so we should set the flag to the value.
    await client.system.unstable_setExperimentFlag(flag, value);
    if (json === true) {
      console.info(JSON.stringify({ flag, value }));
      return;
    }
    console.info(`Set flag "${flag}" to ${value}.`);
  }
});

export const flags = flagsCommand;
