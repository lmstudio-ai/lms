import { SimpleLogger, text } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import { flag, option, optional, string } from "cmd-ts";
import inquirer from "inquirer";
import { platform } from "os";
import { clearLine, moveCursor } from "readline";
import { getCliPref } from "./cliPref";
import { type LogLevelArgs, type LogLevelMap } from "./logLevel";
import {
  checkHttpServer,
  getServerConfig,
  startServer,
  type StartServerOpts,
} from "./subcommands/server";
import { refinedNumber } from "./types/refinedNumber";

export const createClientArgs = {
  yes: flag({
    long: "yes",
    short: "y",
    description: text`
      Suppress all confirmations and warnings. Useful for scripting.
    `,
  }),
  noLaunch: flag({
    long: "no-launch",
    description: text`
      Don't launch LM Studio if it's not running. Have no effect if auto start server is disabled.
    `,
  }),
  host: option({
    type: optional(string),
    long: "host",
    description: text`
      The host to connect to. Default is "127.0.0.1".
    `,
  }),
  port: option({
    type: optional(refinedNumber({ integer: true, min: 0, max: 65535 })),
    long: "port",
    description: text`
      The port to connect to. If not provided and the host is set to "127.0.0.1" (default), the last
      used port will be used; otherwise, 1234 will be used.
    `,
  }),
};

interface CreateClientArgs {
  yes?: boolean;
  noLaunch?: boolean;
  host?: string;
  port?: number;
}

async function maybeTryStartServer(logger: SimpleLogger, startServerOpts: StartServerOpts) {
  const { yes } = startServerOpts;
  const pref = await getCliPref(logger);
  if (pref.get().autoStartServer === undefined && !yes) {
    process.stderr.write(text`
      ${"\n"}${chalk.greenBright.underline("Server Auto Start")}

      LM Studio needs to be running in server mode to perform this operation.${"\n\n"}
    `);
    const { cont } = await inquirer.createPromptModule({
      output: process.stderr,
    })([
      {
        type: "confirm",
        name: "cont",
        message: "Do you want to always start the server if it's not running? (will not ask again)",
        default: true,
      },
    ]);
    if (cont) {
      logger.info("lms will automatically start the server if it's not running.");
    } else {
      logger.info("lms WILL NOT automatically start the server if it's not running.");
    }
    if (platform() === "win32") {
      logger.info(text`
        To change this, edit the config file at
        ${chalk.greenBright("%USERPROFILE%\\.cache\\lm-studio\\.internal\\cli-pref.json")}
      `);
    } else {
      logger.info(text`
        To change this, edit the config file at
        ${chalk.greenBright("~/.cache/lm-studio/.internal/cli-pref.json")}
      `);
    }
    pref.setWithProducer(draft => {
      draft.autoStartServer = cont;
    });
    if (!cont) {
      logger.error(text`
        To start the server manually, run the following command:

            ${chalk.yellow("lms server start ")}${"\n"}
      `);
      return false;
    }
    logger.info("Starting the server...");
    return await startServer(logger, startServerOpts);
  }
  if (pref.get().autoStartServer === true) {
    logger.info("LM Studio is not running in server mode. Starting the server...");
    return await startServer(logger, startServerOpts);
  } else if (pref.get().autoStartServer === false) {
    logger.error("LM Studio needs to be running in the server mode to perform this operation.");
    if (platform() === "win32") {
      logger.error(text`
        To automatically start the server, edit the config file at
        ${chalk.yellowBright("%USERPROFILE%\\.cache\\lm-studio\\.internal\\cli-pref.json")}
      `);
    } else {
      logger.error(text`
        To automatically start the server, edit the config file at
        ${chalk.yellowBright("~/.cache/lm-studio/.internal/cli-pref.json")}
      `);
    }
    logger.error(text`
      To start the server manually, run the following command:

          ${chalk.yellow("lms server start ")}${"\n"}
    `);
    return false;
  } else {
    // If not true or false, it's undefined
    // Meaning --yes is used
    logger.info(text`
      LM Studio is not running in server mode. Starting the server because
      ${chalk.yellowBright("--yes")} is set
    `);
    return await startServer(logger, startServerOpts);
  }
}

/**
 * Creates a logger that will self delete messages at info level.
 */
function createSelfDeletingLogger(logger: SimpleLogger, levelMap: LogLevelMap) {
  return new SimpleLogger(
    "",
    {
      debug: levelMap.debug
        ? (...messages) => {
            clearLine(process.stderr, 0);
            logger.debug(...messages);
          }
        : () => {},
      info: levelMap.info
        ? (...messages) => {
            clearLine(process.stderr, 0);
            logger.info(...messages);
            if (!levelMap.debug) {
              moveCursor(process.stderr, 0, -1);
            }
          }
        : () => {},
      warn: levelMap.warn
        ? (...messages) => {
            clearLine(process.stderr, 0);
            logger.warn(...messages);
          }
        : () => {},
      error: levelMap.error
        ? (...messages) => {
            clearLine(process.stderr, 0);
            logger.error(...messages);
          }
        : () => {},
    },

    { useLogLevelPrefixes: false },
  );
}

export interface CreateClientOpts {}

export async function createClient(
  logger: SimpleLogger,
  args: CreateClientArgs & LogLevelArgs,
  _opts: CreateClientOpts = {},
) {
  const { noLaunch, yes } = args;
  let { host, port } = args;
  if (host === undefined) {
    host = "127.0.0.1";
  } else if (host.includes("://")) {
    logger.error("Host should not include the protocol.");
    process.exit(1);
  } else if (host.includes(":")) {
    logger.error(
      `Host should not include the port number. Use ${chalk.yellowBright("--port")} instead.`,
    );
    process.exit(1);
  }
  if (port === undefined) {
    if (host === "127.0.0.1") {
      try {
        const config = await getServerConfig(logger);
        port = config.port;
      } catch (e) {
        logger.debug("Failed to get last server status", e);
        port = 1234;
      }
    } else {
      port = 1234;
    }
  }
  logger.debug(`Connecting to server at ${host}:${port}`);
  if (!(await checkHttpServer(logger, port, host))) {
    if (host === "127.0.0.1") {
      if (!(await maybeTryStartServer(logger, { port, noLaunch, yes, useReducedLogging: true }))) {
        process.exit(1);
      }
    } else {
      logger.error(
        text`
          The server does not appear to be running at ${host}:${port}. Please make sure the server
          is running and accessible at the specified address.
        `,
      );
      process.exit(1);
    }
  }
  const baseUrl = `ws://${host}:${port}`;
  logger.debug(`Connecting to server with baseUrl ${port}`);
  return new LMStudioClient({
    baseUrl,
    logger,
    clientIdentifier: "lms-cli",
  });
}
