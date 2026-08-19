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
  // The persisted REST config describes only *this* machine's server, so it must not leak into a
  // remote launch. For --host, mirror createClient: it connects using --port or DEFAULT_SERVER_PORT
  // (never the locally-saved port), on the host the user asked for -- otherwise the tool is wired to
  // http://<remote>:<local-port>/v1 and the readiness probe/start hits the wrong remote port.
  const cfg =
    opts.host === undefined ? await getServerConfig(logger).catch(() => undefined) : undefined;
  // A local launch always talks to loopback and reuses only the saved *port* (like
  // `lms server start`). We deliberately ignore the persisted networkInterface: it may be 0.0.0.0 or
  // a LAN address, and honoring it would make launch connect over -- or, when auto-starting a
  // stopped server below, silently expose the inference server on -- a public interface the user
  // never asked launch to use. A 0.0.0.0-bound server that is already running is still reachable
  // here over loopback.
  const host = opts.host ?? "127.0.0.1";
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
      // Bind loopback only -- never the persisted (possibly public) interface -- so `lms launch`
      // does not expose the local inference server to the network on the user's behalf.
      networkInterface: "127.0.0.1",
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
