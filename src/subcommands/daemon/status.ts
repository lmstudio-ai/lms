import { Command, type OptionValues } from "@commander-js/extra-typings";
import { createClient } from "../../createClient.js";
import { t } from "../../i18n/index.js";
import { tryFindLocalAPIServer } from "../../localAPIServer.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";

type DaemonStatusCommandOptions = OptionValues &
  LogLevelArgs & {
    json?: boolean;
  };

export const status = new Command<[], DaemonStatusCommandOptions>()
  .name("status")
  .description(t("Check the status of the LM Studio daemon"))
  .option("--json", t("Output status in JSON format"));

addLogLevelOptions(status);

// Report the selected running app without waking another installation.
status.action(async (options: DaemonStatusCommandOptions) => {
  const logger = createLogger(options);
  const useJson = options.json ?? false;

  const serverStatus = await tryFindLocalAPIServer({ logger });
  if (serverStatus === null) {
    if (useJson === true) {
      console.log(JSON.stringify({ status: "not-running" }));
    } else {
      console.info(t("LM Studio is not running"));
    }
  } else {
    await using client = await createClient(logger, {}, { localAPIServer: serverStatus });
    const daemonInfo = await client.system.getInfo();
    if (useJson === true) {
      console.log(
        JSON.stringify({ status: "running", pid: daemonInfo.pid, isDaemon: daemonInfo.isDaemon }),
      );
    } else {
      const processName = daemonInfo.isDaemon
        ? "llmster"
        : serverStatus.package === "bionic"
          ? "Bionic"
          : "LM Studio";
      console.info(
        t(`{p0} v{p1} is running (PID: {p2})`, {
          p0: processName,
          p1: daemonInfo.version,
          p2: daemonInfo.pid,
        }),
      );
    }
  }
});
