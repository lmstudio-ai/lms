import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { command, flag, number, option, optional, subcommands } from "cmd-ts";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { wakeUpService } from "../createClient.js";
import { serverConfigPath, serverCtlPath } from "../lmstudioPaths.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

type HttpServerCtl =
  | {
      type: "start";
      port: number;
      cors?: boolean;
    }
  | {
      type: "stop";
    };

interface HttpServerConfig {
  port: number;
}

/**
 * Write a control object to the server control file.
 */
async function writeToServerCtl(logger: SimpleLogger, controlObject: HttpServerCtl) {
  logger.debug(`Resolved serverCtlPath: ${serverCtlPath}`);
  const dir = path.dirname(serverCtlPath);
  logger.debug(`Making sure directory exists: ${dir}`);
  await mkdir(dir, { recursive: true });
  logger.debug(`Writing control object to ${serverCtlPath}:`, controlObject);
  await writeFile(serverCtlPath, JSON.stringify(controlObject));
}

/**
 * Waits for the server control file to be cleared.
 */
async function waitForCtlFileClear(
  logger: SimpleLogger,
  checkIntervalMs: number,
  maxAttempts: number,
) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    const isEmpty = (await readFile(serverCtlPath, "utf-8")).length === 0;
    if (isEmpty) {
      logger.debug(`Attempt ${i + 1}: File has been cleared`);
      return true;
    } else {
      logger.debug(`Attempt ${i + 1}: File has not been cleared`);
    }
  }
  return false;
}

/**
 * Checks if the HTTP server is running.
 */
export async function checkHttpServer(
  logger: SimpleLogger,
  port: number,
  host: string = "127.0.0.1",
) {
  const url = `http://${host}:${port}/lmstudio-greeting`;
  logger.debug(`Checking server at ${url}`);
  try {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 500).unref();
    const response = await fetch(url, { signal: abortController.signal });
    if (response.status !== 200) {
      logger.debug(`Status is not 200: ${response.status}`);
      return false;
    }
    const json = await response.json();
    if (json?.lmstudio !== true) {
      logger.debug(`Not an LM Studio server:`, json);
      return false;
    }
  } catch (e) {
    logger.debug(`Failed to check server:`, e);
    return false;
  }
  return true;
}

/**
 * Checks the HTTP server with retries.
 */
async function checkHttpServerWithRetries(logger: SimpleLogger, port: number, maxAttempts: number) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkHttpServer(logger, port)) {
      logger.debug(`Checked server on attempt ${i + 1}: Server is running`);
      return true;
    } else {
      logger.debug(`Checked server on attempt ${i + 1}: Server is not running`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * Gets the last status of the server.
 */
export async function getServerConfig(logger: SimpleLogger) {
  const lastStatusPath = serverConfigPath;
  logger.debug(`Reading last status from ${lastStatusPath}`);
  const lastStatus = JSON.parse(await readFile(lastStatusPath, "utf-8")) as HttpServerConfig;
  return lastStatus;
}

export interface StartServerOpts {
  port?: number;
  cors?: boolean;
}
export async function startServer(
  logger: SimpleLogger,
  { port, cors }: StartServerOpts = {},
): Promise<boolean> {
  if (port === undefined) {
    try {
      port = (await getServerConfig(logger)).port;
      logger.debug(`Read from last status: port=${port}`);
    } catch (e) {
      logger.debug(`Failed to read last status`, e);
      port = 1234;
      logger.debug(`Using default port ${port}`);
    }
  } else {
    logger.debug(`Using provided port ${port}`);
  }
  if (cors) {
    logger.warnText`
      CORS is enabled. This means any website you visit can use the LM Studio server.
    `;
  }
  logger.debug(`Attempting to start the server on port ${port}...`);
  logger.info("Starting server...");
  await writeToServerCtl(logger, { type: "start", port, cors });
  if (await waitForCtlFileClear(logger, 500, 10)) {
    logger.debug(`Requested the server to be started on port ${port}.`);
  } else {
    const launched = await wakeUpService(logger);
    if (launched) {
      logger.debug(`LM Studio service is running.`);
      // At this point, LM Studio is launching. Once it is ready, it will consume the control file
      // and start the server. Let's wait for that to happen.
      if (await waitForCtlFileClear(logger, 1000, 10)) {
        logger.debug(`Requested the server to be started on port ${port}.`);
      } else {
        logger.error(`Failed to start the server on port ${port}`);
        process.exit(1);
      }
    } else {
      logger.errorText`
        Failed to start LM Studio service. Please make sure it is installed and have run it at
        least once.
      `;
      return false;
    }
  }
  logger.debug("Verifying the server is running...");

  if (await checkHttpServerWithRetries(logger, port, 5)) {
    logger.info(`Success! Server is now running on port ${port}`);
    return true;
  } else {
    logger.error("Failed to verify the server is running. Please try to use another port.");
    return false;
  }
}

const start = command({
  name: "start",
  description: "Starts the local server",
  args: {
    port: option({
      type: optional(number),
      description: text`
        Port to run the server on. If not provided, the server will run on the same port as the last
        time it was started.
      `,
      long: "port",
      short: "p",
    }),
    cors: flag({
      description: text`
        Enable CORS on the server. Allows any website you visit to access the server. This is
        required if you are developing a web application.
      `,
      long: "cors",
    }),
    ...logLevelArgs,
  },
  handler: async args => {
    const { port, cors } = args;
    const logger = createLogger(args);
    if (!(await startServer(logger, { port, cors }))) {
      process.exit(1);
    }
  },
});

const stop = command({
  name: "stop",
  description: "Stops the local server",
  args: {
    ...logLevelArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    let port: number;
    try {
      port = (await getServerConfig(logger)).port;
    } catch (e) {
      logger.error(`The server is not running.`);
      process.exit(1);
    }
    const running = await checkHttpServer(logger, port);
    if (!running) {
      logger.error(`The server is not running.`);
      process.exit(1);
    }
    logger.debug(`Attempting to stop the server on port ${port}...`);
    await writeToServerCtl(logger, { type: "stop" });
    if (await waitForCtlFileClear(logger, 100, 10)) {
      logger.info(`Stopped the server on port ${port}.`);
    } else {
      logger.error(`Failed to stop the server on port ${port}`);
      process.exit(1);
    }
  },
});

const status = command({
  name: "status",
  description: "Displays the status of the local server",
  args: {
    ...logLevelArgs,
    json: flag({
      long: "json",
      description: text`
        Outputs the status in JSON format to stdout.
      `,
    }),
  },
  handler: async args => {
    const logger = createLogger(args);
    const { json } = args;
    let port: null | number = null;
    try {
      port = (await getServerConfig(logger)).port;
    } catch (e) {
      logger.debug(`Failed to read last status`, e);
    }
    let running = false;
    if (port !== null) {
      running = await checkHttpServer(logger, port);
    }
    if (running) {
      logger.info(`The server is running on port ${port}.`);
    } else {
      logger.info(`The server is not running.`);
    }
    if (json) {
      process.stdout.write(JSON.stringify({ running, port }) + "\n");
    }
  },
});

export const server = subcommands({
  name: "server",
  description: "Commands for managing the local server",
  cmds: {
    start,
    status,
    stop,
  },
});
