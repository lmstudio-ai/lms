import { text } from "@lmstudio/lms-common";
import { command, flag, optional, positional, string, type Type } from "cmd-ts";
import { createClient, createClientArgs } from "../createClient.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

const trueFalseType: Type<string, boolean> = {
  async from(str) {
    str = str.trim().toLowerCase();
    if (str === "true") {
      return true;
    } else if (str === "false") {
      return false;
    }
    throw new Error("Expected 'true' or 'false'");
  },
  displayName: "true|false",
  description: "A boolean value, either 'true' or 'false'",
};

export const flagsCommand = command({
  name: "flags",
  description: "Set or get experiment flags",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
    flag: positional({
      type: optional(string),
      description: "The flag to set or get",
      displayName: "flag",
    }),
    value: positional({
      type: optional(trueFalseType),
      description: "The value to set the flag to",
      displayName: "value",
    }),
    json: flag({
      long: "json",
      description: text`
        Outputs the result in JSON format to stdout.
      `,
    }),
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    const { flag, value, json } = args;

    if (flag === undefined) {
      // User did not provide a flag, so we should show all flags.
      const flags = await client.system.unstable_getExperimentFlags();
      if (json) {
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
      if (json) {
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
      if (json) {
        console.info(JSON.stringify({ flag, value }));
        return;
      }
      console.info(`Set flag "${flag}" to ${value}.`);
    }
  },
});
