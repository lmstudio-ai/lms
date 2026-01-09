import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";

type WhoamiCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

const whoamiCommand = new Command<[], WhoamiCommandOptions>()
  .name("whoami")
  .description(text`Check the current authentication status`);

addCreateClientOptions(whoamiCommand);
addLogLevelOptions(whoamiCommand);

whoamiCommand.action(async options => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);

  const authStatus = await client.repository.getAuthenticationStatus();

  if (authStatus !== null) {
    logger.info(`You are currently logged in as: ${authStatus.userName}`);
  } else {
    logger.info("You are not currently logged in.");
  }
});

export const whoami = whoamiCommand;
