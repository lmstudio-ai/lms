import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";

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

  await client.repository.deauthenticate();
  logger.info("Successfully logged out.");
});

export const logout = logoutCommand;
