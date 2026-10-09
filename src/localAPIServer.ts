import { apiServerPorts, type LoggerInterface } from "@lmstudio/lms-common";
import {
  getLocalAPIServerStatusAtPortOrThrow,
  type APIServerStatus,
} from "@lmstudio/lms-common-server";
import { spawn } from "child_process";
import { once } from "events";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { setTimeout } from "timers/promises";
import { z } from "zod";
import { apiServerInfoPath, lmstudioHome } from "./lmstudioPaths.js";

export interface LocalAPIServer extends APIServerStatus {
  /** Discovery, authentication, and REST settings must belong to the same app. */
  internalFolder: string;
}

interface LocalAPIServerOpts {
  logger: LoggerInterface;
  home?: string;
}

const serverInfoSchema = z.object({
  port: z.number().int().min(1).max(65535),
  pid: z.number().int().positive().optional(),
});
const installLocationSchema = z.object({
  path: z.string().min(1),
  argv: z.array(z.string()),
  cwd: z.string().min(1),
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

/** Prefers LM Studio/llmster over Bionic; an explicit instance override never falls back. */
export async function tryFindLocalAPIServer({
  logger,
  home = lmstudioHome,
}: LocalAPIServerOpts): Promise<LocalAPIServer | null> {
  const internalFolder = join(home, ".internal");
  /** Keeps a discovered endpoint paired with the directory supplying its credentials. */
  async function probe(
    port: number | null,
    folder = internalFolder,
  ): Promise<LocalAPIServer | null> {
    if (port === null) {
      return null;
    }
    try {
      return {
        ...(await getLocalAPIServerStatusAtPortOrThrow(port, 3000)),
        internalFolder: folder,
      };
    } catch (error) {
      logger.debug(`Failed to find local API server on port ${port}:`, error);
      return null;
    }
  }

  const override = process.env.LMS_API_SERVER_INFO_PATH;
  if (override !== undefined) {
    return await probe(readLocalAPIServerPort(override), dirname(override));
  }
  const publishedPort = readLocalAPIServerPort(join(internalFolder, "http-server.json"));
  const publishedServer = await probe(publishedPort);
  if (publishedServer?.package === "lmstudio" || publishedServer?.package === "daemon") {
    return publishedServer;
  }
  // Only LM Studio/llmster use legacy port scanning. Dev Bionic instances must not win this race.
  const legacyServers = await Promise.all(
    apiServerPorts.filter(port => port !== publishedPort).map(port => probe(port)),
  );
  const legacyServer = legacyServers.find(
    server => server?.package === "lmstudio" || server?.package === "daemon",
  );
  if (legacyServer !== undefined) {
    return legacyServer;
  }
  const bionicFolder = join(home, "apps", "bionic", ".internal");
  const bionicServer = await probe(
    readLocalAPIServerPort(join(bionicFolder, "http-server.json")),
    bionicFolder,
  );
  if (bionicServer?.package === "bionic") {
    return bionicServer;
  }
  // Older Bionic versions used the canonical home. Prefer private discovery over leftovers.
  return publishedServer?.package === "bionic" ? publishedServer : null;
}

/** Uses a running app, or tries llmster, LM Studio, then Bionic, skipping failed launches. */
export async function findOrStartLocalAPIServer({
  logger,
  home = lmstudioHome,
}: LocalAPIServerOpts): Promise<LocalAPIServer | null> {
  const runningServer = await tryFindLocalAPIServer({ logger, home });
  if (runningServer !== null || process.env.LMS_API_SERVER_INFO_PATH !== undefined) {
    return runningServer;
  }
  for (const relativePath of [
    ".internal/llmster-install-location.json",
    ".internal/app-install-location.json",
    "apps/bionic/.internal/app-install-location.json",
  ]) {
    try {
      const {
        path: executablePath,
        argv: processArguments,
        cwd: workingDirectory,
      } = installLocationSchema.parse(JSON.parse(readFileSync(join(home, relativePath), "utf-8")));
      const launchArguments = processArguments[1] === "." ? ["."] : [];
      if (!relativePath.endsWith("llmster-install-location.json")) {
        launchArguments.push("--run-as-service");
      }
      const child = spawn(executablePath, launchArguments, {
        cwd: workingDirectory,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...(process.platform === "linux" ? { DISPLAY: ":0" } : {}), ...process.env },
      });
      // Spawn validates the executable and working directory, including stale install records.
      await once(child, "spawn");
      child.unref();
      logger.info("Starting local model service...");
      logger.debug("Starting local app:", { executablePath, launchArguments, workingDirectory });
      for (let attempt = 0; attempt < 60; attempt++) {
        await setTimeout(1000);
        const server = await tryFindLocalAPIServer({ logger, home });
        if (server !== null) {
          return server;
        }
        // A process exiting without an API is a failed launch, even with exit code 0.
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `Local app exited before publishing its API (code ${child.exitCode}, signal ${child.signalCode}).`,
          );
        }
      }
      child.kill();
      throw new Error("Timed out waiting for the local app to start.");
    } catch (error) {
      logger.debug(`Cannot start the installation recorded at ${relativePath}:`, error);
    }
  }
  logger.error("No running LM Studio or Bionic app, and no valid installation was found.");
  return null;
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
