import { Command, type OptionValues } from "@commander-js/extra-typings";
import { tryFindLocalAPIServer } from "@lmstudio/lms-common-server";
import { createClient } from "../../createClient.js";
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

up.action(async (options: DaemonUpCommandOptions) => {
  const logger = createLogger(options);
  const useJson = options.json ?? false;

  const previousStatus = await tryFindLocalAPIServer(logger);
  await using client = await createClient(logger);
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
    if (previousStatus !== null) {
      if (daemonInfo.isDaemon) {
        console.info(`The daemon is already running (PID: ${daemonInfo.pid}).`);
      } else {
        console.info(
          `LM Studio is already running (PID: ${daemonInfo.pid}); not starting a second daemon.`,
        );
      }
    } else {
      if (daemonInfo.isDaemon) {
        console.info(`llmster started (PID: ${daemonInfo.pid}).`);
      } else {
        console.info(`LM Studio started (PID: ${daemonInfo.pid}).`);
      }
    }
  }
});

export { up };
