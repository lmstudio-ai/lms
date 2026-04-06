import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { Spinner } from "../Spinner.js";
import { normalizeAuthenticationStatus } from "../authenticationStatusUtils.js";

type LogoutCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

const logoutCommand = new Command<[], LogoutCommandOptions>()
  .name("logout")
  .description(text`Log out of LM Studio`);

addCreateClientOptions(logoutCommand);
addLogLevelOptions(logoutCommand);

logoutCommand.action(async options => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);

  const authenticationStatus = normalizeAuthenticationStatus(
    await client.repository.getAuthenticationStatus(),
  );

  switch (authenticationStatus.type) {
    case "none":
      logger.info("You were already logged out.");
      return;
    case "computeDevice":
      break;
    case "loggedInUser":
      break;
    default: {
      const exhaustiveCheck: never = authenticationStatus;
      throw new Error(`Unexpected authentication status: ${exhaustiveCheck}`);
    }
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
  if (authenticationStatus.type === "computeDevice") {
    logger.info("Successfully logged out and removed compute-device identity.");
    return;
  }
  logger.info("Successfully logged out.");
});

export const logout = logoutCommand;
