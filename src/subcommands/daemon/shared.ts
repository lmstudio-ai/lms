import { apiServerPorts } from "@lmstudio/lms-common";
import { LMStudioClient, type ServiceInfo } from "@lmstudio/sdk";
import { existsSync, readFileSync } from "fs";
import { dirname } from "path";
import { llmsterInstallLocationFilePath } from "../../lmstudioPaths.js";
import type { createLogger } from "../../logLevel.js";

type Logger = ReturnType<typeof createLogger>;

export type DaemonInfoResult = { status: "not-running" } | ({ status: "running" } & ServiceInfo);

export interface InstallLocationFileContent {
  path?: string;
  argv?: Array<string>;
  cwd?: string;
}

export interface InstallLocationData {
  executablePath: string;
  workingDirectory: string;
  argv: Array<string>;
}

export async function fetchDaemonInfo(logger: Logger): Promise<DaemonInfoResult> {
  const probeStatus = async (port: number): Promise<number | undefined> => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/lms-status`, { method: "GET" });
      const isOk = response.status === 200;
      if (isOk === true) {
        return port;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  };

  const availablePorts: Array<number> = [];
  for (const port of apiServerPorts) {
    const reachablePort = await probeStatus(port);
    if (reachablePort !== undefined) {
      availablePorts.push(reachablePort);
    }
  }

  if (availablePorts.length === 0) {
    return { status: "not-running" };
  }

  const fetchInfoForPort = async (
    port: number,
  ): Promise<(ServiceInfo & { port: number }) | undefined> => {
    try {
      await using client = new LMStudioClient({
        baseUrl: `ws://127.0.0.1:${port}`,
        logger,
      });
      const info = await client.system.getInfo();
      return { ...info, port };
    } catch {
      return undefined;
    }
  };

  const infoResults: Array<ServiceInfo & { port: number }> = [];
  for (const port of availablePorts) {
    const infoResult = await fetchInfoForPort(port);
    if (infoResult !== undefined) {
      infoResults.push(infoResult);
    }
  }

  if (infoResults.length === 0) {
    return { status: "not-running" };
  }

  const daemonResult = infoResults.find(result => result.isDaemon === true);
  const chosen = daemonResult ?? infoResults[0];

  return { status: "running", ...chosen };
}

export function readInstallLocationOrExit(logger: Logger): InstallLocationData {
  const installLocationPath = llmsterInstallLocationFilePath;
  const installLocationDescription = "llmster-install-location.json";

  if (existsSync(installLocationPath) === false) {
    logger.error(`Cannot find install location file at ${installLocationPath}.`);
    process.exit(1);
  }

  let parsedInstallLocation: InstallLocationFileContent | undefined;
  try {
    const rawInstallLocation = readFileSync(installLocationPath, "utf-8");
    const parsedInstallLocationUnknown: unknown = JSON.parse(rawInstallLocation);
    if (typeof parsedInstallLocationUnknown === "object" && parsedInstallLocationUnknown !== null) {
      parsedInstallLocation = parsedInstallLocationUnknown as InstallLocationFileContent;
    }
  } catch (error) {
    logger.error(
      `Failed to read or parse install location from ${installLocationDescription} at ${installLocationPath}:`,
      error as Error,
    );
    process.exit(1);
  }

  if (
    parsedInstallLocation === undefined ||
    typeof parsedInstallLocation.path !== "string" ||
    parsedInstallLocation.path.length === 0
  ) {
    logger.error(
      `Install location file ${installLocationDescription} at ${installLocationPath} does not contain a valid executable path.`,
    );
    process.exit(1);
  }

  const executablePath = parsedInstallLocation.path;
  const hasCustomCwd =
    parsedInstallLocation.cwd !== undefined &&
    typeof parsedInstallLocation.cwd === "string" &&
    parsedInstallLocation.cwd.length > 0;
  let workingDirectory: string = dirname(executablePath);
  if (hasCustomCwd === true) {
    workingDirectory = parsedInstallLocation.cwd as string;
  }

  const parsedArgv = Array.isArray(parsedInstallLocation.argv) ? parsedInstallLocation.argv : [];
  const normalizedArgv = parsedArgv.filter(argument => typeof argument === "string");

  return {
    executablePath,
    workingDirectory,
    argv: normalizedArgv,
  };
}
