import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { lmstudioHome } from "./lmstudioPaths.js";
import {
  tryFindLocalAPIServer,
  type LocalAPIServer,
  type LocalAPIServerOpts,
} from "./localAPIServer.js";

const installLocationSchema = z.object({
  path: z.string().min(1),
  argv: z.array(z.string()),
  cwd: z.string().min(1),
});

interface FindOrStartLocalAPIServerOpts extends LocalAPIServerOpts {
  maxAttempts?: number;
  pollIntervalMs?: number;
}

/**
 * Uses a running app before starting anything. Cold starts prefer llmster, then LM Studio, then
 * Bionic, skipping stale installations without rewriting any app's installation records.
 */
export async function findOrStartLocalAPIServer({
  logger,
  home = lmstudioHome,
  maxAttempts = 60,
  pollIntervalMs = 1000,
}: FindOrStartLocalAPIServerOpts): Promise<LocalAPIServer | null> {
  const runningServer = await tryFindLocalAPIServer({ logger, home });
  if (runningServer !== null || process.env.LMS_API_SERVER_INFO_PATH !== undefined) {
    return runningServer;
  }

  const installations = [
    { file: join(home, ".internal", "llmster-install-location.json"), isDaemon: true },
    { file: join(home, ".internal", "app-install-location.json"), isDaemon: false },
    {
      file: join(home, "apps", "bionic", ".internal", "app-install-location.json"),
      isDaemon: false,
    },
  ];
  for (const { file, isDaemon } of installations) {
    try {
      const {
        path: executablePath,
        argv: processArguments,
        cwd: workingDirectory,
      } = installLocationSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
      if (!existsSync(executablePath) || !existsSync(workingDirectory)) {
        continue;
      }
      const launchArguments = processArguments[1] === "." ? ["."] : [];
      if (!isDaemon) {
        launchArguments.push("--run-as-service");
      }
      logger.info("Starting local model service...");
      logger.debug("Starting local app:", { executablePath, launchArguments, workingDirectory });
      const child = spawn(executablePath, launchArguments, {
        cwd: workingDirectory,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...(process.platform === "linux" ? { DISPLAY: ":0" } : {}), ...process.env },
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
    } catch (error) {
      logger.debug(`Cannot start the installation recorded at ${file}:`, error);
      continue;
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      const server = await tryFindLocalAPIServer({ logger, home });
      if (server !== null) {
        return server;
      }
    }
    logger.error("Timed out waiting for the local app to start.");
    return null;
  }

  logger.error("No running LM Studio or Bionic app, and no valid installation was found.");
  return null;
}
