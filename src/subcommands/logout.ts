import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { Spinner } from "../Spinner.js";

type LogoutCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

const logoutCommand = new Command<[], LogoutCommandOptions>()
  .name("logout")
  .description(text`Log out of LM Studio`);

addCreateClientOptions(logoutCommand);
addLogLevelOptions(logoutCommand);

logoutCommand.action(async options => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);

  const isAuthenticated = await client.repository.isAuthenticated();

  if (!isAuthenticated) {
    logger.info("You were already logged out.");
    return;
  }

  const shouldShowSpinner =
    process.stdout.isTTY && options.logLevel !== "none" && options.quiet !== true;

  const spinner = shouldShowSpinner ? new Spinner("Logging out...") : null;

  const sigintHandler = () => {
    spinner?.stopIfNotStopped();
    process.exit(130);
  };

  if (spinner) {
    process.on("SIGINT", sigintHandler);
  }

  try {
    await client.repository.deauthenticate();
  } finally {
    if (spinner) {
      process.off("SIGINT", sigintHandler);
      spinner.stopIfNotStopped();
    }
  }
  logger.info("Successfully logged out.");
});

export const logout = logoutCommand;
