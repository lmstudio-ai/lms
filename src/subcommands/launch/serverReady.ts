import { text, type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import { checkHttpServer, DEFAULT_SERVER_PORT } from "../../createClient.js";
import { UserInputError } from "../../types/UserInputError.js";
import { checkHttpServerWithRetries, getServerConfig } from "../server.js";

export interface ServerEndpoint {
  host: string;
  port: number;
  origin: string;
}

export interface EnsureRestServerOpts {
  port?: number;
  host?: string;
  skipCheck?: boolean;
}

/**
 * Ensures the LM Studio REST inference server (the HTTP surface coding CLIs talk to) is reachable,
 * starting it if necessary. This is a *different* server from the WebSocket/SDK control channel
 * that `createClient()` wakes -- `createClient()` alone does not start it.
 */
export async function ensureRestServer(
  client: LMStudioClient,
  logger: SimpleLogger,
  opts: EnsureRestServerOpts = {},
): Promise<ServerEndpoint> {
  const cfg = await getServerConfig(logger).catch(() => undefined);
  const bind = cfg?.networkInterface;
  // A server bound to 0.0.0.0 (all interfaces) is still reached locally over loopback.
  const host = opts.host ?? (bind === undefined || bind === "0.0.0.0" ? "127.0.0.1" : bind);
  const port = opts.port ?? cfg?.port ?? DEFAULT_SERVER_PORT;
  const origin = `http://${host}:${port}`;

  if (opts.skipCheck === true) {
    return { host, port, origin };
  }

  if (await checkHttpServer(logger, port, host)) {
    return { host, port, origin };
  }

  logger.info(`Starting the LM Studio server on port ${port}...`);
  try {
    await client.system.startHttpServer({
      port,
      cors: false,
      networkInterface: bind ?? "127.0.0.1",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new UserInputError(text`
      Could not start the LM Studio server on port ${String(port)}. Start it manually with
      "lms server start" and try again. (${message})
    `);
  }

  if (await checkHttpServerWithRetries(logger, port, host, 5)) {
    return { host, port, origin };
  }
  throw new UserInputError(text`
    The LM Studio server did not become reachable on ${host}:${String(port)}. Try
    "lms server start".
  `);
}
