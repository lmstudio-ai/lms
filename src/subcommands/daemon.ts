import { Command, type OptionValues } from "@commander-js/extra-typings";
import { LMStudioClient } from "@lmstudio/sdk";
import { tryFindLocalAPIServer } from "../createClient.js";
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
  const port = await tryFindLocalAPIServer();

  if (port === null) {
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
      baseUrl: `ws://127.0.0.1:${port}`,
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

export const daemon = new Command()
  .name("daemon")
  .description("Commands for managing the LM Studio daemon")
  .addCommand(status);
