import { Command, type OptionValues } from "@commander-js/extra-typings";
import { spawn } from "child_process";
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

    const spawnOptions = {
      cwd: installLocation.workingDirectory,
      stdio: "inherit" as const,
    };

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
    const child = spawn(installLocation.executablePath, upgradeArgs, spawnOptions);
    child.on("exit", code => {
      process.exit(code === null ? 1 : code);
    });
    child.on("error", error => {
      logger.error("Failed to launch llmster for upgrade:", error);
      process.exit(1);
    });
  });

addLogLevelOptions(updateDaemon);

export { updateDaemon };
