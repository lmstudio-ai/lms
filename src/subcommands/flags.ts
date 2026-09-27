import {
  Argument,
  Command,
  InvalidArgumentError,
  type OptionValues,
} from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { t } from "../i18n/index.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";

const trueFalseParser = (str: string): boolean => {
  str = str.trim().toLowerCase();
  if (str === "true") {
    return true;
  } else if (str === "false") {
    return false;
  }
  throw new InvalidArgumentError(t("Expected 'true' or 'false'"));
};

type FlagsCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    json?: boolean;
  };

const flagsCommand = new Command<[], FlagsCommandOptions>()
  .name("flags")
  .description(t("Set or get experiment flags"))
  .option(
    "--json",
    t(text`
      Outputs the result in JSON format to stdout.
    `),
  )
  .argument("[flag]", t("The flag to set or get"))
  .addArgument(
    new Argument("[value]", t("The value to set the flag to")).argParser(trueFalseParser),
  );

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
      logger.error(t("No experiment flags are set."));
      return;
    }
    console.info(t("Enabled experiment flags:"));
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
      console.info(t(`Flag "{p0}" is currently enabled.`, { p0: flag }));
    } else {
      console.info(t(`Flag "{p0}" is currently disabled.`, { p0: flag }));
    }
  } else {
    // User provided a flag and a value, so we should set the flag to the value.
    await client.system.unstable_setExperimentFlag(flag, value);
    if (json === true) {
      console.info(JSON.stringify({ flag, value }));
      return;
    }
    console.info(t(`Set flag "{p0}" to {p1}.`, { p0: flag, p1: value }));
  }
});

export const flags = flagsCommand;
