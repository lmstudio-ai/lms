import { Command, type OptionValues } from "@commander-js/extra-typings";
import { createClient } from "../../createClient.js";
import { findOrStartLocalAPIServer, tryFindLocalAPIServer } from "../../localAPIServer.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";

type DaemonUpCommandOptions = OptionValues &
  LogLevelArgs & {
    json?: boolean;
  };

const up = new Command<[], DaemonUpCommandOptions>()
  .name("up")
  .description("Manually start the llmster daemon")
  .option("--json", "Output result in JSON format");

addLogLevelOptions(up);

// Reuse the selected running app before considering a cold start.
up.action(async (options: DaemonUpCommandOptions) => {
  const logger = createLogger(options);
  const useJson = options.json ?? false;

  const previousStatus = await tryFindLocalAPIServer({ logger });
  const selectedServer = previousStatus ?? (await findOrStartLocalAPIServer({ logger }));
  if (selectedServer === null) {
    logger.error("Failed to start or connect to a local LM Studio or Bionic API server.");
    process.exit(1);
  }
  await using client = await createClient(logger, {}, { localAPIServer: selectedServer });
  const daemonInfo = await client.system.getInfo();

  if (useJson) {
    console.info(
      JSON.stringify({
        status: "running",
        pid: daemonInfo.pid,
        isDaemon: daemonInfo.isDaemon,
        version: daemonInfo.version,
      }),
    );
  } else {
    const appName = selectedServer.package === "bionic" ? "Bionic" : "LM Studio";
    if (previousStatus !== null) {
      if (daemonInfo.isDaemon) {
        console.info(`The daemon is already running (PID: ${daemonInfo.pid}).`);
      } else {
        console.info(
          `${appName} is already running (PID: ${daemonInfo.pid}); not starting a second daemon.`,
        );
      }
    } else {
      if (daemonInfo.isDaemon) {
        console.info(`llmster started (PID: ${daemonInfo.pid}).`);
      } else {
        console.info(`${appName} started (PID: ${daemonInfo.pid}).`);
      }
    }
  }
});

export { up };
