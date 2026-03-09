import { Option, type Command, type OptionValues } from "@commander-js/extra-typings";
import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { findOrStartLlmster } from "@lmstudio/lms-common-server";
import { LMStudioClient, type LMStudioClientConstructorOpts } from "@lmstudio/sdk";
import chalk from "chalk";
import { randomBytes } from "crypto";
import { readFile } from "fs/promises";
import { exists } from "./exists.js";
import { lmsKey2Path } from "./lmstudioPaths.js";
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

export interface CreateClientOpts {}
const lmsKey = "<LMS-CLI-LMS-KEY>";

export async function createClient(
  logger: SimpleLogger,
  args: CreateClientArgs & LogLevelArgs = {},
  _opts: CreateClientOpts = {},
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
    // Use shared helper to find or start llmster
    const serverStatus = await findOrStartLlmster({ logger });

    if (serverStatus !== null) {
      const baseUrl = `ws://${host}:${serverStatus.port}`;
      logger.debug(`Found local API server at ${baseUrl}`);

      if (auth.clientIdentifier === "lms-cli") {
        // Refetch the lms key due to the possibility of a new key being generated.
        const lmsKey2 = (await readFile(lmsKey2Path, "utf-8")).trim();
        auth = {
          ...auth,
          clientPasskey: lmsKey + lmsKey2,
        };
      }

      return new LMStudioClient({ baseUrl, logger, ...auth });
    }

    logger.error("Failed to start or connect to local LM Studio API server.");
    process.exit(1);
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
    process.exit(1);
  }
  const baseUrl = `ws://${host}:${port}`;
  logger.debug(`Found server at ${port}`);
  const client = new LMStudioClient({
    baseUrl,
    logger,
    ...auth,
  });

  return client;
}
