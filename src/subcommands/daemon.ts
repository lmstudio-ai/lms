import { Command, type OptionValues } from "@commander-js/extra-typings";
import { findLMStudioHome, tryFindLocalAPIServer } from "@lmstudio/lms-common-server";
import { LMStudioClient } from "@lmstudio/sdk";
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";

type DaemonStatusCommandOptions = OptionValues &
  LogLevelArgs & {
    json?: boolean;
  };

const status = new Command<[], DaemonStatusCommandOptions>()
  .name("status")
  .description("Check the status of the LM Studio daemon")
  .option("--json", "Output status in JSON format");

addLogLevelOptions(status);

status.action(async (options: DaemonStatusCommandOptions) => {
  const logger = createLogger(options);
  const useJson = options.json ?? false;

  // First, check if the daemon is running without waking it up
  const serverStatus = await tryFindLocalAPIServer(logger);

  if (serverStatus === null) {
    // Daemon is not running
    if (useJson) {
      console.log(JSON.stringify({ status: "not-running" }));
    } else {
      console.info("LM Studio is not running");
    }
    return;
  }

  // Daemon is running, now get detailed info
  try {
    await using client = new LMStudioClient({
      baseUrl: `ws://127.0.0.1:${serverStatus.port}`,
      logger,
    });

    const info = await client.system.getInfo();

    // Sanity check the PID
    if (!Number.isInteger(info.pid) || info.pid <= 0) {
      console.error("Received invalid PID from server");
      process.exit(1);
    }

    // Output results
    if (useJson) {
      console.log(JSON.stringify({ status: "running", pid: info.pid }));
    } else {
      const processName = info.isDaemon ? "llmster" : "LM Studio";
      console.info(`${processName} is running (PID: ${info.pid})`);
    }
  } catch (error) {
    console.error("Failed to get daemon info:", error);
    process.exit(1);
  }
});

type DaemonUpdateCommandOptions = OptionValues &
  LogLevelArgs & {
    beta?: boolean;
    channel?: string;
  };

const updateDaemon = new Command<[], DaemonUpdateCommandOptions>()
  .name("update")
  .description("Update the llmster daemon")
  .option("--beta", "Use the beta channel for the daemon upgrade")
  .option("--channel <name>", "Use the specified channel for the daemon upgrade")
  .action(async (options: DaemonUpdateCommandOptions) => {
    const logger = createLogger(options);

    const lmstudioHome = findLMStudioHome();
    const installLocationPath = join(lmstudioHome, ".internal", "app-install-location.json");
    if (existsSync(installLocationPath) === false) {
      logger.error(`Cannot find install location file at ${installLocationPath}.`);
      process.exit(1);
    }

    let executablePath: string | undefined;
    let workingDirectory: string | undefined;
    try {
      const rawInstallLocation = readFileSync(installLocationPath, "utf-8");
      const parsedInstallLocation = JSON.parse(rawInstallLocation) as {
        path?: string;
        cwd?: string;
      };
      if (typeof parsedInstallLocation.path === "string") {
        executablePath = parsedInstallLocation.path;
        if (typeof parsedInstallLocation.cwd === "string" && parsedInstallLocation.cwd.length > 0) {
          workingDirectory = parsedInstallLocation.cwd;
        } else {
          workingDirectory = dirname(executablePath);
        }
      }
    } catch (error) {
      logger.error(
        `Failed to read or parse install location from ${installLocationPath}:`,
        error as Error,
      );
      process.exit(1);
    }

    if (executablePath === undefined || executablePath.length === 0) {
      logger.error(
        `Install location file ${installLocationPath} does not contain a valid executable path.`,
      );
      process.exit(1);
    }

    const spawnOptions = {
      cwd: workingDirectory,
      stdio: "inherit" as const,
    };

    const upgradeArgs = ["upgrade"];
    if (options.beta === true) {
      upgradeArgs.push("--beta");
    } else if (options.channel !== undefined && options.channel.length > 0) {
      upgradeArgs.push(`--channel=${options.channel}`);
    }

    logger.info(`Starting llmster upgrade using ${executablePath}...`);
    const child = spawn(executablePath, upgradeArgs, spawnOptions);
    child.on("exit", code => {
      process.exit(code === null ? 1 : code);
    });
    child.on("error", error => {
      logger.error("Failed to launch llmster for upgrade:", error);
      process.exit(1);
    });
  });

export const daemon = new Command()
  .name("daemon")
  .description("Commands for managing the LM Studio daemon")
  .addCommand(status)
  .addCommand(updateDaemon);
