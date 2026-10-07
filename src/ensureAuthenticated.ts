import { makePromise, makeTitledPrettyError, text, type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import {
  makeCannotLoginWhileComputeDeviceError,
  normalizeAuthenticationStatus,
} from "./authenticationStatusUtils.js";
import { t } from "./i18n/index.js";

export async function ensureAuthenticated(
  client: LMStudioClient,
  logger: SimpleLogger,
  { yes = false }: { yes?: boolean } = {},
) {
  const authenticationStatus = normalizeAuthenticationStatus(
    await client.repository.getAuthenticationStatus(),
  );
  if (authenticationStatus.type === "loggedInUser") {
    return;
  }
  if (authenticationStatus.type === "computeDevice") {
    throw makeCannotLoginWhileComputeDeviceError(authenticationStatus);
  }

  const { promise, resolve, reject } = makePromise<void>();
  client.repository
    .ensureAuthenticated({
      onAuthenticationCode: ({ code, manualUrl, filledUrl }) => {
        if (yes) {
          reject(
            makeTitledPrettyError(
              t("Authentication required"),
              t(
                text`
                This operation requires you to be authenticated. Inline authentication disabled due
                to {p0} flag. Please use {p1}
                to authenticate before running this command again.
              `,
                { p0: chalk.yellow("--yes"), p1: chalk.yellow("lms login") },
              ),
            ),
          );
        } else {
          logger.info();
          logger.info(
            t(`Visit {p0} and enter the following code to authenticate:`, {
              p0: chalk.yellowBright(manualUrl),
            }),
          );
          logger.info();
          logger.info(chalk.yellowBright(`    ${code}`));
          logger.info();
          logger.info(t("Or visit the following URL directly:"));
          logger.info();
          logger.info(`    ${filledUrl}`);
          logger.info();
        }
      },
    })
    .then(resolve, reject);

  await promise;
}
