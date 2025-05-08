import chalk from "chalk";
import { command } from "cmd-ts";
import { createClient, createClientArgs } from "../createClient.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

export const login = command({
  name: "login",
  description: "Authenticate with LM Studio",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    let askedToAuthenticate = false;
    await client.repository.ensureAuthenticated({
      onAuthenticationUrl: url => {
        askedToAuthenticate = true;
        logger.info("Please visit the following URL to authenticate:");
        logger.info();
        logger.info(chalk.greenBright(`    ${url}`));
        logger.info();
      },
    });
    if (!askedToAuthenticate) {
      logger.info("You are already authenticated.");
    } else {
      logger.info("Authentication successful.");
    }
  },
});
