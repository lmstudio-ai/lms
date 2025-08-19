import { Option, type Command, type OptionValues } from "@commander-js/extra-typings";
import { makePrettyError, SimpleLogger, text } from "@lmstudio/lms-common";
import chalk from "chalk";
import { Console } from "console";

const levels = ["debug", "info", "warn", "error", "none"] as const;

/**
 * Adds log level options to a commander.js command
 */
export function addLogLevelOptions<
  Args extends any[],
  Opts extends OptionValues,
  GlobalOpts extends OptionValues,
>(command: Command<Args, Opts, GlobalOpts>) {
  return command
    .addOption(new Option("--log-level <level>", "The level of logging to use").choices(levels))
    .option("--verbose", "Enable verbose logging")
    .option("--quiet", "Suppress all logging");
}

export interface LogLevelArgs {
  logLevel?: "debug" | "info" | "warn" | "error" | "none";
  verbose?: boolean;
  quiet?: boolean;
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
  if (verbose === true) {
    numSpecified++;
  }
  if (quiet === true) {
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
  if (quiet === true) {
    logLevel = "none";
  }
  if (verbose === true) {
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
    infoPrefix:
      verbose === true || logLevel === "debug"
        ? undefined // If it is verbose, we use the default I
        : null, // Otherwise, no I
  });
}
