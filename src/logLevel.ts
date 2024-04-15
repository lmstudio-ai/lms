import { SimpleLogger, text } from "@lmstudio/lms-common";
import { flag, oneOf, option, optional } from "cmd-ts";
import { Console } from "console";

const levels = ["debug", "info", "warn", "error", "none"] as const;

export const logLevelArgs = {
  logLevel: option({
    type: optional(oneOf(levels)),
    description: text`
      The level of logging to use. If not provided, the default level is "info".
    `,
    long: "log-level",
  }),
  verbose: flag({
    long: "verbose",
    description: text`
      Enable verbose logging.
    `,
  }),
  quiet: flag({
    long: "quiet",
    description: text`
      Suppress all logging.
    `,
  }),
};

export function createLogger({
  logLevel,
  verbose,
  quiet,
}: {
  logLevel: "debug" | "info" | "warn" | "error" | "none" | undefined;
  verbose: boolean;
  quiet: boolean;
}): SimpleLogger {
  let numSpecified = 0;
  if (logLevel !== undefined) {
    numSpecified++;
  }
  if (verbose) {
    numSpecified++;
  }
  if (quiet) {
    numSpecified++;
  }
  if (numSpecified > 1) {
    throw new Error("Only one of logLevel, verbose, or quiet can be specified");
  }
  if (quiet) {
    logLevel = "none";
  }
  if (verbose) {
    logLevel = "debug";
  }
  const level = levels.indexOf(logLevel ?? "info");
  const console = new Console({
    stdout: process.stderr,
    stderr: process.stderr,
  });
  const consoleObj = {
    info: level <= levels.indexOf("info") ? console.info : () => {},
    warn: level <= levels.indexOf("warn") ? console.warn : () => {},
    error: level <= levels.indexOf("error") ? console.error : () => {},
    debug: level <= levels.indexOf("debug") ? console.debug : () => {},
  };
  return new SimpleLogger("", consoleObj);
}
