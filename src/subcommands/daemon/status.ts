import { Command, type OptionValues } from "@commander-js/extra-typings";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { fetchDaemonInfo } from "./shared.js";

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

  try {
    const daemonInfo = await fetchDaemonInfo(logger);

    if (daemonInfo.status === "not-running") {
      if (useJson === true) {
        console.log(JSON.stringify({ status: "not-running" }));
      } else {
        console.info("LM Studio is not running");
      }
      return;
    }

    if (Number.isInteger(daemonInfo.pid) !== true || daemonInfo.pid <= 0) {
      console.error("Received invalid PID from server");
      process.exit(1);
    }

    if (useJson === true) {
      console.log(
        JSON.stringify({ status: "running", pid: daemonInfo.pid, isDaemon: daemonInfo.isDaemon }),
      );
    } else {
      const processName = daemonInfo.isDaemon === true ? "llmster" : "LM Studio";
      console.info(`${processName} is running (PID: ${daemonInfo.pid})`);
    }
  } catch (error) {
    console.error("Failed to get daemon info:", error);
    process.exit(1);
  }
});

type DaemonInfoCommandOptions = OptionValues &
  LogLevelArgs & {
    json?: boolean;
  };

const info = new Command<[], DaemonInfoCommandOptions>()
  .name("info")
  .description("Show daemon status including version/build information")
  .option("--json", "Output info in JSON format");

addLogLevelOptions(info);

info.action(async (options: DaemonInfoCommandOptions) => {
  const logger = createLogger(options);
  const useJson = options.json ?? false;

  try {
    const daemonInfo = await fetchDaemonInfo(logger);

    if (daemonInfo.status === "not-running") {
      const notRunningPayload = { status: "not-running" };
      if (useJson === true) {
        console.log(JSON.stringify(notRunningPayload));
      } else {
        console.info("LM Studio is not running");
      }
      return;
    }

    if (Number.isInteger(daemonInfo.pid) !== true || daemonInfo.pid <= 0) {
      console.error("Received invalid PID from server");
      process.exit(1);
    }

    if (useJson === true) {
      console.log(
        JSON.stringify({
          status: "running",
          pid: daemonInfo.pid,
          version: daemonInfo.version,
          isDaemon: daemonInfo.isDaemon,
        }),
      );
      return;
    }

    const processName = daemonInfo.isDaemon === true ? "llmster" : "LM Studio";
    console.info(`${processName} is running (PID: ${daemonInfo.pid})`);
    console.info(`Version: ${daemonInfo.version}`);
  } catch (error) {
    console.error("Failed to get daemon info:", error);
    process.exit(1);
  }
});

export { info, status };
