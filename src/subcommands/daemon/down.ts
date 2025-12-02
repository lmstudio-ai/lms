import { Command, type OptionValues } from "@commander-js/extra-typings";
import { tryFindLocalAPIServer } from "@lmstudio/lms-common-server";
import { createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";

type DaemonDownCommandOptions = OptionValues & LogLevelArgs;

const down = new Command<[], DaemonDownCommandOptions>()
  .name("down")
  .description("Manually shutdown the llmster daemon");

addLogLevelOptions(down);

down.action(async (options: DaemonDownCommandOptions) => {
  const logger = createLogger(options);

  const previousStatus = await tryFindLocalAPIServer(logger);

  if (previousStatus === null) {
    logger.info("Daemon is not running.");
    process.exit(1);
  } else {
    await using client = await createClient(logger);
    const daemonInfo = await client.system.getInfo();
    if (daemonInfo.isDaemon) {
      logger.info("Shutting down llmster...");
      await client.system.requestShutdown();
      logger.info("Done.");
    } else {
      logger.infoText`
        The daemon is currently running as part of LM Studio. Please exit LM Studio to stop it.
      `;
      process.exit(1);
    }
  }
});

export { down };
