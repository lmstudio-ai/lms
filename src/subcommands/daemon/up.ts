import { Command, type OptionValues } from "@commander-js/extra-typings";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { fetchDaemonInfo } from "./shared.js";

type DaemonUpCommandOptions = OptionValues &
  LogLevelArgs & {
    json?: boolean;
  };

const up = new Command<[], DaemonUpCommandOptions>()
  .name("up")
  .description("Manually start the llmster daemon")
  .option("--json", "Output result in JSON format");

addCreateClientOptions(up);
addLogLevelOptions(up);

up.action(async (options: DaemonUpCommandOptions) => {
  const logger = createLogger(options);
  const useJson = options.json ?? false;

  const currentStatus = await fetchDaemonInfo(logger);
  if (currentStatus.status === "running") {
    if (useJson === true) {
      console.log(
        JSON.stringify({
          status: "running",
          pid: currentStatus.pid,
          isDaemon: currentStatus.isDaemon,
          version: currentStatus.version,
        }),
      );
    } else {
      if (currentStatus.isDaemon === true) {
        console.info(`The daemon is already running (PID: ${currentStatus.pid}).`);
      } else {
        console.info(
          `LM Studio is already running (PID: ${currentStatus.pid}); not starting a second daemon.`,
        );
      }
    }
    return;
  }

  // Creating a client will find or start the daemon (via findOrStartLlmster) and establish a connection.
  await using client = await createClient(logger, options);
  const daemonInfo = await client.system.getInfo();

  if (useJson === true) {
    console.log(
      JSON.stringify({
        status: "running",
        pid: daemonInfo.pid,
        isDaemon: daemonInfo.isDaemon,
        version: daemonInfo.version,
      }),
    );
    return;
  }

  const processName = daemonInfo.isDaemon === true ? "llmster" : "LM Studio";
  console.info(`${processName} started (PID: ${daemonInfo.pid}).`);
});

export { up };
