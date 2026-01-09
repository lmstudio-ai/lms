import { makePromise, makeTitledPrettyError, text, type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";

export async function ensureAuthenticated(
  client: LMStudioClient,
  logger: SimpleLogger,
  { yes = false }: { yes?: boolean } = {},
) {
  const { promise, resolve, reject } = makePromise<void>();
  client.repository
    .ensureAuthenticated({
      onAuthenticationCode: ({ code, manualUrl, filledUrl }) => {
        if (yes) {
          reject(
            makeTitledPrettyError(
              "Authentication required",
              text`
                This operation requires you to be authenticated. Inline authentication disabled due
                to ${chalk.yellow("--yes")} flag. Please use ${chalk.yellow("lms login")}
                to authenticate before running this command again.
              `,
            ),
          );
        } else {
          logger.info();
          logger.info(
            `Visit ${chalk.yellowBright(manualUrl)} and enter the following code to authenticate:`,
          );
          logger.info();
          logger.info(chalk.yellowBright(`    ${code}`));
          logger.info();
          logger.info("Or visit the following URL directly:");
          logger.info();
          logger.info(`    ${filledUrl}`);
          logger.info();
        }
      },
    })
    .then(resolve, reject);

  await promise;
}
