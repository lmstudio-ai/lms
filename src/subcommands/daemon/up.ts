import { Command, type OptionValues } from "@commander-js/extra-typings";
import { createClient } from "../../createClient.js";
import { t } from "../../i18n/index.js";
import { tryFindLocalAPIServer } from "../../localAPIServer.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";

type DaemonUpCommandOptions = OptionValues &
  LogLevelArgs & {
    json?: boolean;
  };

const up = new Command<[], DaemonUpCommandOptions>()
  .name("up")
  .description(t("Manually start the llmster daemon"))
  .option("--json", t("Output result in JSON format"));

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
        console.info(t(`The daemon is already running (PID: {p0}).`, { p0: daemonInfo.pid }));
      } else {
        console.info(
          t(`LM Studio is already running (PID: {p0}); not starting a second daemon.`, {
            p0: daemonInfo.pid,
          }),
        );
      }
    } else {
      if (daemonInfo.isDaemon) {
        console.info(t(`llmster started (PID: {p0}).`, { p0: daemonInfo.pid }));
      } else {
        console.info(t(`LM Studio started (PID: {p0}).`, { p0: daemonInfo.pid }));
      }
    }
  }
});

export { up };
