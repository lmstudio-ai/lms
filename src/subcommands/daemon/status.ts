import { Command, type OptionValues } from "@commander-js/extra-typings";
import { tryFindLocalAPIServer } from "@lmstudio/lms-common-server";
import { createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";

type DaemonStatusCommandOptions = OptionValues &
  LogLevelArgs & {
    json?: boolean;
  };

export const status = new Command<[], DaemonStatusCommandOptions>()
  .name("status")
  .description("Check the status of the LM Studio daemon")
  .option("--json", "Output status in JSON format");

addLogLevelOptions(status);

status.action(async (options: DaemonStatusCommandOptions) => {
  const logger = createLogger(options);
  const useJson = options.json ?? false;

  const serverStatus = await tryFindLocalAPIServer(logger);
  if (serverStatus === null) {
    if (useJson === true) {
      console.log(JSON.stringify({ status: "not-running" }));
    } else {
      console.info("LM Studio is not running");
    }
  } else {
    await using client = await createClient(logger);
    const daemonInfo = await client.system.getInfo();
    if (useJson === true) {
      console.log(
        JSON.stringify({ status: "running", pid: daemonInfo.pid, isDaemon: daemonInfo.isDaemon }),
      );
    } else {
      const processName = daemonInfo.isDaemon === true ? "llmster" : "LM Studio";
      console.info(`${processName} v${daemonInfo.version} is running (PID: ${daemonInfo.pid})`);
    }
  }
});
