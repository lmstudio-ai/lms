import { Command, type OptionValues } from "@commander-js/extra-typings";
import { spawn, spawnSync } from "child_process";
import * as readline from "readline";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { readInstallLocationOrExit } from "./shared.js";

type DaemonUpdateCommandOptions = OptionValues &
  LogLevelArgs & {
    beta?: boolean;
    channel?: string;
  };

type LibatomicCheckResult =
  | { status: "ok" }
  | { status: "ldconfig-unavailable"; error: string }
  | { status: "no-libatomic" };

function checkLinuxLibatomic(): LibatomicCheckResult {
  try {
    const result = spawnSync("ldconfig", ["-p"], { encoding: "utf-8" });
    if (result.error !== undefined) {
      return { status: "ldconfig-unavailable", error: result.error.message };
    }
    return (result.stdout ?? "").includes("libatomic.so.1")
      ? { status: "ok" }
      : { status: "no-libatomic" };
  } catch (error) {
    return { status: "ldconfig-unavailable", error: String(error) };
  }
}

const updateDaemon = new Command<[], DaemonUpdateCommandOptions>()
  .name("update")
  .description("Update the llmster daemon")
  .option("--beta", "Use the beta channel for the daemon upgrade")
  .option("--channel <name>", "Use the specified channel for the daemon upgrade")
  .action(async (options: DaemonUpdateCommandOptions) => {
    const logger = createLogger(options);

    const installLocation = readInstallLocationOrExit(logger);

    const upgradeArgs = ["upgrade"];
    if (options.beta === true) {
      upgradeArgs.push("--beta");
    } else if (options.channel !== undefined && options.channel.length > 0) {
      upgradeArgs.push(`--channel=${options.channel}`);
    }
    if (options.verbose === true || options.logLevel === "debug") {
      upgradeArgs.push("--verbose");
    }

    if (process.platform === "linux") {
      const libatomicCheck = checkLinuxLibatomic();
      if (libatomicCheck.status === "ldconfig-unavailable") {
        logger.error(`"ldconfig" must be available on your PATH before updating.

Please ensure ldconfig is installed and on your PATH, then run this again:

      lms daemon update

Error details: ${libatomicCheck.error}
`);
        process.exit(1);
      } else if (libatomicCheck.status === "no-libatomic") {
        logger.info(`📣 Notice: One-time dependency update needed.

The next version of llmster requires "libatomic", which is not currently installed on your system.

1. To install it:

      Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y libatomic1
      Fedora/RHEL:  sudo dnf install -y libatomic

2. Afterwards, run this again:

      lms daemon update
`);
        process.exit(1);
      }
    }

    logger.info(`Starting llmster upgrade using ${installLocation.executablePath}...`);

    // On Windows, we will start the updater in a new window to prevent issues with lms.exe being
    // used.
    if (process.platform === "win32") {
      // Prompt user before opening new terminal
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      await new Promise<void>(resolve => {
        rl.question("We will run the updater in a new terminal. Hit <ENTER> to continue.", () => {
          rl.close();
          resolve();
        });
      });

      // Use cmd.exe to start the process in a new window
      const child = spawn(
        "cmd.exe",
        ["/c", "start", "", installLocation.executablePath, ...upgradeArgs],
        {
          cwd: installLocation.workingDirectory,
          detached: true,
        },
      );

      child.unref();
      process.exit(0);
    } else {
      // On other platforms, run directly.
      const child = spawn(installLocation.executablePath, upgradeArgs, {
        cwd: installLocation.workingDirectory,
        stdio: "inherit",
      });
      child.on("exit", code => {
        process.exit(code === null ? 1 : code);
      });
      child.on("error", error => {
        logger.error("Failed to launch llmster for upgrade:", error);
        process.exit(1);
      });
    }
  });

addLogLevelOptions(updateDaemon);

export { updateDaemon };
