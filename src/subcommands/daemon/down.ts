import { Command, type OptionValues } from "@commander-js/extra-typings";
import { createClient } from "../../createClient.js";
import { t } from "../../i18n/index.js";
import { tryFindLocalAPIServer } from "../../localAPIServer.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { text } from "@lmstudio/lms-common";

type DaemonDownCommandOptions = OptionValues & LogLevelArgs;

const down = new Command<[], DaemonDownCommandOptions>()
  .name("down")
  .description(t("Manually shutdown the llmster daemon"));

addLogLevelOptions(down);

// Keep the shutdown request on the app whose daemon status was checked.
down.action(async (options: DaemonDownCommandOptions) => {
  const logger = createLogger(options);

  const previousStatus = await tryFindLocalAPIServer({ logger });

  if (previousStatus === null) {
    logger.info(t("Daemon is not running."));
    process.exit(1);
  } else {
    await using client = await createClient(logger, {}, { localAPIServer: previousStatus });
    const daemonInfo = await client.system.getInfo();
    if (daemonInfo.isDaemon) {
      logger.info(t("Shutting down llmster..."));
      await client.system.requestShutdown();
      logger.info(t("Done."));
    } else {
      const appName = previousStatus.package === "bionic" ? "Bionic" : "LM Studio";
      logger.info(
        t(
          text`
        The daemon is currently running as part of {p0}. Please exit {p0} to stop it.
      `,
          { p0: appName },
        ),
      );
      process.exit(1);
    }
  }
});

export { down };
