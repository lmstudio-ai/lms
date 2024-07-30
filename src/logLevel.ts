import { makePrettyError, SimpleLogger, text } from "@lmstudio/lms-common";
import chalk from "chalk";
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

export interface LogLevelArgs {
  logLevel: "debug" | "info" | "warn" | "error" | "none" | undefined;
  verbose: boolean;
  quiet: boolean;
}

export interface LogLevelMap {
  debug: boolean;
  info: boolean;
  warn: boolean;
  error: boolean;
}

export function getLogLevelMap({ logLevel, verbose, quiet }: LogLevelArgs): LogLevelMap {
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
    throw makePrettyError(
      chalk.redBright(text`
        Only one of ${chalk.yellowBright("--logLevel")}, ${chalk.yellowBright("--verbose")}, or
        ${chalk.yellowBright("--quiet")} can be specified.
      `),
    );
  }
  if (quiet) {
    logLevel = "none";
  }
  if (verbose) {
    logLevel = "debug";
  }
  const level = levels.indexOf(logLevel ?? "info");
  return {
    debug: level <= levels.indexOf("debug"),
    info: level <= levels.indexOf("info"),
    warn: level <= levels.indexOf("warn"),
    error: level <= levels.indexOf("error"),
  };
}

export function createLogger({ logLevel, verbose, quiet }: LogLevelArgs): SimpleLogger {
  const console = new Console({
    stdout: process.stderr,
    stderr: process.stderr,
  });
  const levelMap = getLogLevelMap({ logLevel, verbose, quiet });
  const consoleObj = {
    debug: levelMap.debug ? console.debug : () => {},
    info: levelMap.info ? console.info : () => {},
    warn: levelMap.warn ? console.warn : () => {},
    error: levelMap.error ? console.error : () => {},
  };
  return new SimpleLogger("", consoleObj, {
    useLogLevelPrefixes: true,
  });
}
