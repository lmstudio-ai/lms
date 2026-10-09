import { apiServerPorts, type LoggerInterface } from "@lmstudio/lms-common";
import {
  getLocalAPIServerStatusAtPortOrThrow,
  type APIServerStatus,
} from "@lmstudio/lms-common-server";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { z } from "zod";
import { apiServerInfoPath, lmstudioHome } from "./lmstudioPaths.js";

export interface LocalAPIServer extends APIServerStatus {
  /** Discovery, authentication, and REST settings must belong to the same app. */
  internalFolder: string;
}

export interface LocalAPIServerOpts {
  logger: LoggerInterface;
  home?: string;
}

const serverInfoSchema = z.object({
  port: z.number().int().min(1).max(65535),
  pid: z.number().int().positive().optional(),
});

/** Reads a published port, rejecting records left by processes that have exited. */
export function readLocalAPIServerPort(
  infoFilePath: string = process.env.LMS_API_SERVER_INFO_PATH ?? apiServerInfoPath,
): number | null {
  try {
    const info = serverInfoSchema.parse(JSON.parse(readFileSync(infoFilePath, "utf-8")));
    if (info.pid !== undefined) {
      process.kill(info.pid, 0);
    }
    return info.port;
  } catch {
    return null;
  }
}

interface ProbeServerOpts {
  port: number | null;
  internalFolder: string;
  logger: LoggerInterface;
}

/** Validates a loopback endpoint while retaining the directory that supplied its credentials. */
async function probeServer({
  port,
  internalFolder,
  logger,
}: ProbeServerOpts): Promise<LocalAPIServer | null> {
  if (port === null) {
    return null;
  }
  try {
    return { ...(await getLocalAPIServerStatusAtPortOrThrow(port, 3000)), internalFolder };
  } catch (error) {
    logger.debug(`Failed to find local API server on port ${port}:`, error);
    return null;
  }
}

/**
 * Prefers a running LM Studio/llmster over Bionic. Explicit development discovery never falls
 * back to another instance. Legacy port scanning is only for LM Studio/llmster, not Bionic.
 */
export async function tryFindLocalAPIServer({
  logger,
  home = lmstudioHome,
}: LocalAPIServerOpts): Promise<LocalAPIServer | null> {
  const override = process.env.LMS_API_SERVER_INFO_PATH;
  if (override !== undefined) {
    return await probeServer({
      port: readLocalAPIServerPort(override),
      internalFolder: dirname(override),
      logger,
    });
  }

  const internalFolder = join(home, ".internal");
  const publishedPort = readLocalAPIServerPort(join(internalFolder, "http-server.json"));
  const publishedServer = await probeServer({ port: publishedPort, internalFolder, logger });
  if (publishedServer?.package === "lmstudio" || publishedServer?.package === "daemon") {
    return publishedServer;
  }

  const legacyServers = await Promise.all(
    apiServerPorts
      .filter(port => port !== publishedPort)
      .map(port => probeServer({ port, internalFolder, logger })),
  );
  const legacyServer = legacyServers.find(
    server => server?.package === "lmstudio" || server?.package === "daemon",
  );
  if (legacyServer !== undefined) {
    return legacyServer;
  }

  const bionicInternalFolder = join(home, "apps", "bionic", ".internal");
  const bionicServer = await probeServer({
    port: readLocalAPIServerPort(join(bionicInternalFolder, "http-server.json")),
    internalFolder: bionicInternalFolder,
    logger,
  });
  if (bionicServer?.package === "bionic") {
    return bionicServer;
  }
  // Older Bionic versions used the canonical home. Prefer current private discovery over leftovers.
  return publishedServer?.package === "bionic" ? publishedServer : null;
}

/** Matches an explicitly requested API or REST port to its app's authentication directory. */
export function getInternalFolderForPort(port: number): string {
  const override = process.env.LMS_API_SERVER_INFO_PATH;
  if (override !== undefined) {
    return dirname(override);
  }
  const internalFolder = join(lmstudioHome, ".internal");
  const bionicInternalFolder = join(lmstudioHome, "apps", "bionic", ".internal");
  for (const file of ["http-server.json", "http-server-config.json"]) {
    for (const candidate of [internalFolder, bionicInternalFolder]) {
      if (readLocalAPIServerPort(join(candidate, file)) === port) {
        return candidate;
      }
    }
  }
  return internalFolder;
}
