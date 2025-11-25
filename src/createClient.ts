import { Option, type Command, type OptionValues } from "@commander-js/extra-typings";
import { apiServerPorts, text, type SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient, type LMStudioClientConstructorOpts } from "@lmstudio/sdk";
import chalk from "chalk";
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { readFile } from "fs/promises";
import { exists } from "./exists.js";
import { appInstallLocationFilePath, lmsKey2Path } from "./lmstudioPaths.js";
import { type LogLevelArgs } from "./logLevel.js";
import { createRefinedNumberParser } from "./types/refinedNumber.js";

export const DEFAULT_SERVER_PORT: number = 1234;

/**
 * Checks if the HTTP server is running.
 */
export async function checkHttpServer(logger: SimpleLogger, port: number, host?: string) {
  const resolvedHost = host ?? "127.0.0.1";
  const url = `http://${resolvedHost}:${port}/lmstudio-greeting`;
  logger.debug(`Checking server at ${url}`);
  try {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(new Error("Connection timed out.")), 500).unref();
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

interface AppInstallLocation {
  path: string;
  argv: Array<string>;
  cwd: string;
}

/**
 * Adds create client options to a commander.js command
 */
export function addCreateClientOptions<
  Args extends any[],
  Opts extends OptionValues,
  GlobalOpts extends OptionValues,
>(command: Command<Args, Opts, GlobalOpts>): Command<Args, Opts & CreateClientArgs, GlobalOpts> {
  return command
    .addOption(
      new Option(
        "--host <host>",
        text`
          If you wish to connect to a remote LM Studio instance, specify the host here. Note that, in
          this case, lms will connect using client identifier "lms-cli-remote-<random chars>", which
          will not be a privileged client, and will restrict usage of functionalities such as
          "lms push".
        `,
      ).hideHelp(),
    )
    .addOption(
      new Option(
        "--port <port>",
        text`
          The port where LM Studio can be reached. If not provided and the host is set to "127.0.0.1"
          (default), the last used port will be used; otherwise, ${DEFAULT_SERVER_PORT} will be used.
        `,
      )
        .argParser(createRefinedNumberParser({ integer: true, min: 0, max: 65535 }))
        .hideHelp(),
    ) as Command<Args, Opts & CreateClientArgs, GlobalOpts>;
}

export interface CreateClientArgs {
  yes?: boolean;
  host?: string;
  port?: number;
}

async function isLocalServerAtPortLMStudioServerOrThrow(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/lmstudio-greeting`);
  if (response.status !== 200) {
    throw new Error("Status is not 200.");
  }
  const json = await response.json();
  if (json?.lmstudio !== true) {
    throw new Error("Not an LM Studio server.");
  }
  return port;
}

export async function tryFindLocalAPIServer(): Promise<number | null> {
  return await Promise.any(apiServerPorts.map(isLocalServerAtPortLMStudioServerOrThrow)).then(
    port => port,
    () => null,
  );
}

export async function wakeUpService(logger: SimpleLogger): Promise<boolean> {
  logger.info("Waking up LM Studio service...");
  const appInstallLocationPath = appInstallLocationFilePath;
  logger.debug(`Resolved appInstallLocationPath: ${appInstallLocationPath}`);
  try {
    const appInstallLocation = JSON.parse(
      await readFile(appInstallLocationPath, "utf-8"),
    ) as AppInstallLocation;
    logger.debug(`Read executable pointer:`, appInstallLocation);

    const args: Array<string> = [];
    const { path, argv, cwd } = appInstallLocation;
    if (argv[1] === ".") {
      // We are in development environment
      args.push(".");
    }
    // Also add the headless flag
    args.push("--run-as-service");

    logger.debug(`Spawning process:`, { path, args, cwd });

    const env = {
      ...(process.platform === "linux" ? { DISPLAY: ":0" } : {}),
      ...process.env,
    };

    const child = spawn(path, args, { cwd, detached: true, stdio: "ignore", env });
    child.unref();

    logger.debug(`Process spawned`);
    return true;
  } catch (e) {
    logger.debug(`Failed to launch application`, e);
    return false;
  }
}

export interface CreateClientOpts {
  skipDisposeCheck?: boolean;
}
const lmsKey = "<LMS-CLI-LMS-KEY>";
const undisposedClients = new Set<LMStudioClient>();

export async function createClient(
  logger: SimpleLogger,
  args: CreateClientArgs & LogLevelArgs,
  opts: CreateClientOpts = {},
) {
  let { host, port } = args;
  let isRemote = true;
  if (host === undefined) {
    isRemote = false;
    host = "127.0.0.1";
  } else if (host.includes("://")) {
    logger.error("Host should not include the protocol.");
    process.exit(1);
  } else if (host.includes(":")) {
    logger.error(`Host should not include the port number. Use ${chalk.yellow("--port")} instead.`);
    process.exit(1);
  }
  let auth: LMStudioClientConstructorOpts;
  if (isRemote) {
    // If connecting to a remote server, we will use a random client identifier.
    auth = {
      clientIdentifier: `lms-cli-remote-${randomBytes(18).toString("base64")}`,
    };
  } else {
    // Not remote. We need to check if this is a production build.
    if (
      lmsKey.startsWith("<") &&
      (process.env.LMS_FORCE_PROD === undefined || process.env.LMS_FORCE_PROD === "")
    ) {
      // lmsKey not injected and we did not force prod, this is not a production build.
      logger.warnText`
        You are using a development build of lms-cli. Privileged features such as "lms push" will
        not work.
      `;
      auth = {
        clientIdentifier: "lms-cli-dev",
      };
    } else {
      if (await exists(lmsKey2Path)) {
        const lmsKey2 = (await readFile(lmsKey2Path, "utf-8")).trim();
        auth = {
          clientIdentifier: "lms-cli",
          clientPasskey: lmsKey + lmsKey2,
        };
      } else {
        // This case will happen when the CLI is the production build, yet the local LM Studio has
        // not been run yet (so no lms-key-2 file). In this case, we will just use a dummy client
        // identifier as we will soon try to wake up the service and refetch the key.
        auth = {
          clientIdentifier: "lms-cli",
        };
      }
    }
  }
  if (port === undefined && host === "127.0.0.1") {
    // We will now attempt to connect to the local API server.
    const localPort = await tryFindLocalAPIServer();

    if (localPort !== null) {
      const baseUrl = `ws://${host}:${localPort}`;
      logger.debug(`Found local API server at ${baseUrl}`);
      return new LMStudioClient({ baseUrl, logger, ...auth });
    }

    // At this point, the user wants to access the local LM Studio, but it is not running. We will
    // wake up the service and poll the API server until it is up.

    await wakeUpService(logger);

    // Polling

    for (let i = 1; i <= 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      logger.debug(`Polling the API server... (attempt ${i})`);
      const localPort = await tryFindLocalAPIServer();
      if (localPort !== null) {
        const baseUrl = `ws://${host}:${localPort}`;
        logger.debug(`Found local API server at ${baseUrl}`);

        if (auth.clientIdentifier === "lms-cli") {
          // We need to refetch the lms key due to the possibility of a new key being generated.
          const lmsKey2 = (await readFile(lmsKey2Path, "utf-8")).trim();
          auth = {
            ...auth,
            clientPasskey: lmsKey + lmsKey2,
          };
        }

        return new LMStudioClient({ baseUrl, logger, ...auth });
      }
    }

    logger.error("");
  }

  if (port === undefined) {
    port = DEFAULT_SERVER_PORT;
  }

  logger.debug(`Connecting to server at ${host}:${port}`);
  if (!(await checkHttpServer(logger, port, host))) {
    logger.error(
      text`
        The server does not appear to be running at ${host}:${port}. Please make sure the server
        is running and accessible at the specified address.
      `,
    );
  }
  const baseUrl = `ws://${host}:${port}`;
  logger.debug(`Found server at ${port}`);
  const client = new LMStudioClient({
    baseUrl,
    logger,
    ...auth,
  });

  if (opts.skipDisposeCheck === undefined || opts.skipDisposeCheck === false) {
    undisposedClients.add(client);
    const originalDispose = client[Symbol.asyncDispose].bind(client);
    client[Symbol.asyncDispose] = async () => {
      undisposedClients.delete(client);
      await originalDispose();
    };
  }
  return client;
}

function checkUndisposedClients() {
  if (undisposedClients.size > 0) {
    console.error(
      `ERROR: ${undisposedClients.size} client(s) were not disposed. Use 'await using' or call dispose() explicitly.`,
    );
    process.exit(1);
  }
}

process.on("exit", checkUndisposedClients);
process.on("SIGINT", () => {
  checkUndisposedClients();
  process.exit(130);
});
process.on("SIGTERM", () => {
  checkUndisposedClients();
  process.exit(143);
});
