import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import {
  makeCannotDeSetupComputeDeviceWhileLoggedInError,
  normalizeAuthenticationStatus,
} from "../../authenticationStatusUtils.js";

type DeSetupCommandOptions = OptionValues & LogLevelArgs;

const deSetupCommand = new Command<[], DeSetupCommandOptions>()
  .name("de-setup")
  .description(text`Remove compute-device setup from this machine`);

addLogLevelOptions(deSetupCommand);

deSetupCommand.action(async (options: DeSetupCommandOptions) => {
  const logger = createLogger(options);
  await using client = await createClient(logger);
  const authenticationStatus = normalizeAuthenticationStatus(
    await client.repository.getAuthenticationStatus(),
  );
  switch (authenticationStatus.type) {
    case "none":
      logger.info("This instance is not currently set up as a compute device.");
      return;
    case "loggedInUser":
      throw makeCannotDeSetupComputeDeviceWhileLoggedInError(authenticationStatus);
    case "computeDevice":
      break;
    default: {
      const exhaustiveCheck: never = authenticationStatus;
      throw new Error(`Unexpected authentication status: ${exhaustiveCheck}`);
    }
  }
  await client.repository.lmLink.unstable_deSetupComputeDevice();
  logger.info("Successfully removed compute-device setup.");
});

export const deSetup = deSetupCommand;
