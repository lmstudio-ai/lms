import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";

export async function ensureAuthenticated(client: LMStudioClient, logger: SimpleLogger) {
  await client.repository.ensureAuthenticated({
    onAuthenticationUrl: url => {
      logger.info("Authentication required. Please visit the following URL to authenticate:");
      logger.info();
      logger.info(chalk.greenBright(`    ${url}`));
      logger.info();
    },
  });
}
