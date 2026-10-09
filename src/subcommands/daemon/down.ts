import { Command, type OptionValues } from "@commander-js/extra-typings";
import { createClient } from "../../createClient.js";
import { tryFindLocalAPIServer } from "../../localAPIServer.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";

type DaemonDownCommandOptions = OptionValues & LogLevelArgs;

const down = new Command<[], DaemonDownCommandOptions>()
  .name("down")
  .description("Manually shutdown the llmster daemon");

addLogLevelOptions(down);

// Keep the shutdown request on the app whose daemon status was checked.
down.action(async (options: DaemonDownCommandOptions) => {
  const logger = createLogger(options);

  const previousStatus = await tryFindLocalAPIServer({ logger });

  if (previousStatus === null) {
    logger.info("Daemon is not running.");
    process.exit(1);
  } else {
    await using client = await createClient(logger, {}, { localAPIServer: previousStatus });
    const daemonInfo = await client.system.getInfo();
    if (daemonInfo.isDaemon) {
      logger.info("Shutting down llmster...");
      await client.system.requestShutdown();
      logger.info("Done.");
    } else {
      const appName = previousStatus.package === "bionic" ? "Bionic" : "LM Studio";
      logger.infoText`
        The daemon is currently running as part of ${appName}. Please exit ${appName} to stop it.
      `;
      process.exit(1);
    }
  }
});

export { down };
