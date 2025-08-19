import { Command, Option } from "@commander-js/extra-typings";
import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { readFile } from "fs/promises";
import { checkHttpServer, createClient } from "../createClient.js";
import { serverConfigPath } from "../lmstudioPaths.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";
import { createRefinedNumberParser } from "../types/refinedNumber.js";

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

const start = addLogLevelOptions(
  new Command()
    .name("start")
    .description("Starts the local server")
    .addOption(
      new Option(
        "-p, --port <port>",
        text`
          Port to run the server on. If not provided, the server will run on the same port as the last
          time it was started.
      `,
      ).argParser(createRefinedNumberParser({ integer: true, min: 0, max: 65535 })),
    )
    .option(
      "--cors",
      text`
        Enable CORS on the server. Allows any website you visit to access the server. This is
        required if you are developing a web application.
    `,
    ),
).action(async options => {
  const { port, cors = false } = options;
  const logger = createLogger(options);
  const client = await createClient(logger, options);
  if (cors) {
    logger.warnText`
      CORS is enabled. This means any website you visit can use the LM Studio server.
    `;
  }

  const resolvedPort = port ?? (await getServerConfig(logger)).port ?? 1234;
  logger.debug(`Attempting to start the server on port ${resolvedPort}...`);

  await client.system.startHttpServer({
    port: resolvedPort,
    cors,
  });
  logger.debug("Verifying the server is running...");

  if (await checkHttpServerWithRetries(logger, resolvedPort, 5)) {
    logger.info(`Success! Server is now running on port ${resolvedPort}`);
  } else {
    logger.error("Failed to verify the server is running. Please try to use another port.");
    process.exit(1);
  }
});

const stop = addLogLevelOptions(
  new Command().name("stop").description("Stops the local server"),
).action(async options => {
  const logger = createLogger(options);
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

  const client = await createClient(logger, options);
  await client.system.stopHttpServer();
  logger.info(`Stopped the server on port ${port}.`);
});

const status = addLogLevelOptions(
  new Command()
    .name("status")
    .description("Displays the status of the local server")
    .option(
      "--json",
      text`
        Outputs the status in JSON format to stdout.
    `,
    ),
).action(async options => {
  const logger = createLogger(options);
  const { json = false } = options;
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
});

export const server = new Command()
  .name("server")
  .description("Commands for managing the local server")
  .addCommand(start)
  .addCommand(stop)
  .addCommand(status);
