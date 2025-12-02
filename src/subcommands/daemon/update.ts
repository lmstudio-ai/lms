import { Command, type OptionValues } from "@commander-js/extra-typings";
import { spawn } from "child_process";
import * as readline from "readline";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { readInstallLocationOrExit } from "./shared.js";

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
