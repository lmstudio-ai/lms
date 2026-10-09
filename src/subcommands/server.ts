import { Command, Option, type OptionValues } from "@commander-js/extra-typings";
import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { readFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import {
  checkHttpServer,
  createClient,
  DEFAULT_SERVER_PORT,
  type CreateClientArgs,
} from "../createClient.js";
import { exists } from "../exists.js";
import { findOrStartLocalAPIServer } from "../findOrStartLocalAPIServer.js";
import { tryFindLocalAPIServer, type LocalAPIServer } from "../localAPIServer.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { createRefinedNumberParser } from "../types/refinedNumber.js";

const httpServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  networkInterface: z.string(),
});

type ServerStartCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    port?: number;
    bind?: string;
    cors?: boolean;
  };

type ServerStopCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

type ServerStatusCommandOptions = OptionValues &
  LogLevelArgs & {
    json?: boolean;
  };

/**
 * Checks the HTTP server with retries.
 */
async function checkHttpServerWithRetries(
  logger: SimpleLogger,
  port: number,
  networkInterface: string | undefined,
  maxAttempts: number,
) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkHttpServer(logger, port, networkInterface)) {
      logger.debug(`Checked server on attempt ${i + 1}: Server is running`);
      return true;
    } else {
      logger.debug(`Checked server on attempt ${i + 1}: Server is not running`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

/** Reads REST settings from the same app selected for API requests and authentication. */
export async function getServerConfig(logger: SimpleLogger, localAPIServer: LocalAPIServer) {
  const lastStatusPath = join(localAPIServer.internalFolder, "http-server-config.json");
  if (!(await exists(lastStatusPath))) {
    return undefined;
  }
  logger.debug(`Reading last status from ${lastStatusPath}`);
  return httpServerConfigSchema.parse(JSON.parse(await readFile(lastStatusPath, "utf-8")));
}

const start = new Command<[], ServerStartCommandOptions>()
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
    "--bind <address>",
    text`
      Network address to bind the server to. Use "0.0.0.0" to accept connections from the
      local network, or "127.0.0.1" (default) for localhost only. Can also be set via the
      LMS_SERVER_HOST environment variable.
    `,
  )
  .option(
    "--cors",
    text`
      Enable CORS on the server. Allows any website you visit to access the server. This is
      required if you are developing a web application.
    `,
  );

addLogLevelOptions(start);

// Resolve the app before reading its settings or starting its REST server.
start.action(async options => {
  const { port, bind, cors = false, ...logArgs } = options;
  const logger = createLogger(logArgs);
  const localAPIServer = await findOrStartLocalAPIServer({ logger });
  if (localAPIServer === null) {
    logger.error("Failed to connect to a local app.");
    process.exit(1);
  }
  await using client = await createClient(logger, logArgs, { localAPIServer });
  if (cors) {
    logger.warnText`
      CORS is enabled. This means any website you visit can use the LM Studio server.
    `;
  }

  // Priority order: CLI flag > Environment variable > Persisted setting > Default value
  let envNetworkInterface = process.env.LMS_SERVER_HOST;
  if (envNetworkInterface === "") {
    envNetworkInterface = undefined;
  }
  const resolvedNetworkInterface = bind ?? envNetworkInterface ?? "127.0.0.1";

  const resolvedPort =
    port ??
    (await getServerConfig(logger, localAPIServer))?.port ??
    (localAPIServer.package === "bionic" ? 1235 : DEFAULT_SERVER_PORT);
  logger.debug(`Attempting to start the server on port ${resolvedPort}...`);

  if (resolvedNetworkInterface !== "127.0.0.1") {
    logger.warnText`
      Server will accept connections from the network. Only use this if you know what you are doing!
    `;
  }

  await client.system.startHttpServer({
    port: resolvedPort,
    cors,
    networkInterface: resolvedNetworkInterface,
  });
  logger.debug("Verifying the server is running...");

  if (await checkHttpServerWithRetries(logger, resolvedPort, resolvedNetworkInterface, 5)) {
    logger.info(`Success! Server is now running on port ${resolvedPort}`);
  } else {
    logger.error("Failed to verify the server is running. Please try to use another port.");
    process.exit(1);
  }
});

const stop = new Command<[], ServerStopCommandOptions>()
  .name("stop")
  .description("Stops the local server");

addLogLevelOptions(stop);

// A stop command must not wake an app or switch targets after reading its REST settings.
stop.action(async options => {
  const logger = createLogger(options);
  const localAPIServer = await tryFindLocalAPIServer({ logger });
  if (localAPIServer === null) {
    logger.error("The server is not running.");
    process.exit(1);
  }
  let port: number;
  let networkInterface: string;
  try {
    const serverConfig = await getServerConfig(logger, localAPIServer);
    if (serverConfig === undefined) {
      logger.error("The server is not running.");
      process.exit(1);
    }
    port = serverConfig.port;
    networkInterface = serverConfig.networkInterface;
  } catch (e) {
    logger.error(`The server is not running.`);
    process.exit(1);
  }
  const running = await checkHttpServer(logger, port, networkInterface);
  if (!running) {
    logger.error(`The server is not running.`);
    process.exit(1);
  }

  await using client = await createClient(logger, options, { localAPIServer });
  await client.system.stopHttpServer();
  logger.info(`Stopped the server on port ${port}.`);
});

const status = new Command<[], ServerStatusCommandOptions>()
  .name("status")
  .description("Displays the status of the local server")
  .option(
    "--json",
    text`
      Outputs the status in JSON format to stdout.
  `,
  );

addLogLevelOptions(status);

// Status is read-only and uses the selected app's REST configuration.
status.action(async options => {
  const logger = createLogger(options);
  const localAPIServer = await tryFindLocalAPIServer({ logger });
  const { json = false } = options;
  let port: undefined | number = undefined;
  let networkInterface: undefined | string = undefined;
  try {
    const config =
      localAPIServer === null ? undefined : await getServerConfig(logger, localAPIServer);
    port = config?.port;
    networkInterface = config?.networkInterface;
  } catch (e) {
    logger.debug(`Failed to read last status`, e);
  }
  let running = false;
  if (port !== undefined) {
    running = await checkHttpServer(logger, port, networkInterface);
  }
  if (json) {
    process.stdout.write(JSON.stringify({ running, port }) + "\n");
    return;
  }

  if (running) {
    logger.info(`The server is running on port ${port}.`);
  } else {
    logger.info(`The server is not running.`);
  }
});

export const server = new Command()
  .name("server")
  .description("Commands for managing the local server")
  .addCommand(start)
  .addCommand(stop)
  .addCommand(status);
