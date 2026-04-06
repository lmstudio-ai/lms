import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import {
  formatAuthenticationStatusMessage,
  normalizeAuthenticationStatus,
} from "../authenticationStatusUtils.js";

type WhoamiCommandOptions = OptionValues & CreateClientArgs & LogLevelArgs;

const whoamiCommand = new Command<[], WhoamiCommandOptions>()
  .name("whoami")
  .description(text`Check the current authentication status`);

addCreateClientOptions(whoamiCommand);
addLogLevelOptions(whoamiCommand);

whoamiCommand.action(async options => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);

  const authenticationStatus = normalizeAuthenticationStatus(
    await client.repository.getAuthenticationStatus(),
  );
  logger.info(formatAuthenticationStatusMessage(authenticationStatus));
});

export const whoami = whoamiCommand;
