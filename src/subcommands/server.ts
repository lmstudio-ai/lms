import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { command, flag, number, option, optional, subcommands } from "cmd-ts";
import { readFile } from "fs/promises";
import { checkHttpServer, createClient, createClientArgs } from "../createClient.js";
import { serverConfigPath } from "../lmstudioPaths.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

interface HttpServerConfig {
  port: number;
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

const start = command({
  name: "start",
  description: "Starts the local server",
  args: {
    ...createClientArgs,
    apiPort: option({
      type: optional(number),
      description: text`
        Port to run the server on. If not provided, the server will run on the same port as the last
        time it was started.
      `,
      long: "api-port",
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
    const { apiPort, cors } = args;
    const logger = createLogger(args);
    let assignedPort: number = apiPort ?? 1234;
    const client = await createClient(logger, args);
    if (apiPort === undefined) {
      try {
        assignedPort = (await getServerConfig(logger)).port;
        logger.debug(`Read from last status: port=${apiPort}`);
      } catch (e) {
        logger.debug(`Failed to read last status`, e);
        logger.debug(`Using default port ${apiPort}`);
      }
    } else {
      logger.debug(`Using provided port ${apiPort}`);
    }
    if (cors) {
      logger.warnText`
        CORS is enabled. This means any website you visit can use the LM Studio server.
      `;
    }

    logger.debug(`Attempting to start the server on port ${assignedPort}...`);

    await client.system.startAPIServer(assignedPort, cors);
    logger.debug("Verifying the server is running...");

    if (await checkHttpServerWithRetries(logger, assignedPort, 5)) {
      logger.info(`Success! Server is now running on port ${assignedPort}`);
      return true;
    } else {
      logger.error("Failed to verify the server is running. Please try to use another port.");
      return false;
    }
  },
});

const stop = command({
  name: "stop",
  description: "Stops the local server",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
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

    const client = await createClient(logger, args);
    await client.system.stopAPIServer();
    logger.info(`Stopped the server on port ${port}.`);
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
