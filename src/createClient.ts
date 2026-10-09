import { Option, type Command, type OptionValues } from "@commander-js/extra-typings";
import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient, type LMStudioClientConstructorOpts } from "@lmstudio/sdk";
import chalk from "chalk";
import { randomBytes } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { exists } from "./exists.js";
import {
  findOrStartLocalAPIServer,
  getInternalFolderForPort,
  type LocalAPIServer,
} from "./localAPIServer.js";
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
    const timeout = setTimeout(
      () => abortController.abort(new Error("Connection timed out.")),
      500,
    );
    let response;
    try {
      response = await fetch(url, { signal: abortController.signal });
    } finally {
      clearTimeout(timeout);
    }
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

export interface CreateClientOpts {
  localAPIServer?: LocalAPIServer;
}
const lmsKey = "<LMS-CLI-LMS-KEY>";

/** Resolves the requested LM Studio instance and creates the authenticated CLI client. */
export async function createClient(
  logger: SimpleLogger,
  args: CreateClientArgs & LogLevelArgs = {},
  { localAPIServer }: CreateClientOpts = {},
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
  if (port === undefined && host === "127.0.0.1") {
    const selectedServer = localAPIServer ?? (await findOrStartLocalAPIServer({ logger }));
    if (selectedServer === null) {
      logger.error(
        process.env.LMS_API_SERVER_INFO_PATH === undefined
          ? "Failed to start or connect to a local LM Studio or Bionic API server."
          : `Failed to connect using ${process.env.LMS_API_SERVER_INFO_PATH}.`,
      );
      process.exit(1);
    }
    localAPIServer = selectedServer;
    port = selectedServer.port;
  } else {
    port ??= DEFAULT_SERVER_PORT;
    if (!(await checkHttpServer(logger, port, host))) {
      logger.error(
        text`
          The server does not appear to be running at ${host}:${port}. Please make sure the server
          is running and accessible at the specified address.
        `,
      );
      process.exit(1);
    }
  }

  let auth: LMStudioClientConstructorOpts;
  if (isRemote) {
    // If connecting to a remote server, we will use a random client identifier.
    auth = {
      clientIdentifier: `lms-cli-remote-${randomBytes(18).toString("base64")}`,
    };
  } else if (
    lmsKey.startsWith("<") &&
    (process.env.LMS_FORCE_PROD === undefined || process.env.LMS_FORCE_PROD === "")
  ) {
    // An uninjected key without LMS_FORCE_PROD identifies a development build.
    logger.warnText`
      You are using a development build of lms-cli. Privileged features such as "lms push" will
      not work.
    `;
    auth = { clientIdentifier: "lms-cli-dev" };
  } else {
    // Resolve the key after discovery/startup, which may have generated a fresh app-specific key.
    const lmsKey2Path = join(
      localAPIServer?.internalFolder ?? getInternalFolderForPort(port),
      "lms-key-2",
    );
    // Development instances can accept the CLI identifier without a published key.
    auth = { clientIdentifier: "lms-cli" };
    if (await exists(lmsKey2Path)) {
      auth.clientPasskey = lmsKey + (await readFile(lmsKey2Path, "utf-8")).trim();
    }
  }
  const baseUrl = `ws://${host}:${port}`;
  logger.debug(`Connecting to ${localAPIServer?.package ?? "server"} at ${baseUrl}`);
  return new LMStudioClient({ baseUrl, logger, ...auth });
}
