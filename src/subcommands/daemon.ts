import { Command } from "@commander-js/extra-typings";
import { LMStudioClient } from "@lmstudio/sdk";
import { tryFindLocalAPIServer } from "../createClient.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";

const status = addLogLevelOptions(
  new Command()
    .name("status")
    .description("Check the status of the LM Studio daemon")
    .option("--json", "Output status in JSON format"),
).action(async options => {
  const logger = createLogger(options);
  const useJson = options.json ?? false;

  // First, check if the daemon is running without waking it up
  const port = await tryFindLocalAPIServer();

  if (port === null) {
    // Daemon is not running
    if (useJson) {
      console.log(JSON.stringify({ status: "not-running" }));
    } else {
      logger.info("LM Studio is not running");
    }
    return;
  }

  // Daemon is running, now get detailed info
  try {
    const client = new LMStudioClient({
      baseUrl: `ws://127.0.0.1:${port}`,
      logger,
    });

    const info = await client.system.getInfo();

    // Sanity check the PID
    if (!Number.isInteger(info.pid) || info.pid <= 0) {
      logger.error("Received invalid PID from server");
      process.exit(1);
    }

    // Output results
    if (useJson) {
      console.log(JSON.stringify({ status: "running", pid: info.pid }));
    } else {
      const processName = info.isDaemon ? "llmster" : "LM Studio";
      logger.info(`${processName} is running (PID: ${info.pid})`);
    }
  } catch (error) {
    logger.error("Failed to get daemon info:", error);
    process.exit(1);
  }
});

export const daemon = new Command()
  .name("daemon")
  .description("Commands for managing the LM Studio daemon")
  .addCommand(status);
