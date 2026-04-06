import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { ensureAuthenticated } from "../ensureAuthenticated.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import {
  formatAuthenticationStatusMessage,
  makeCannotLoginWhileComputeDeviceError,
  normalizeAuthenticationStatus,
} from "../authenticationStatusUtils.js";

type LoginCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    withPreAuthenticatedKeys?: boolean;
    keyId?: string;
    publicKey?: string;
    privateKey?: string;
    status?: boolean;
  };

const loginCommand = new Command<[], LoginCommandOptions>()
  .name("login")
  .description(text`Authenticate with LM Studio`)
  .option(
    "--status",
    text`
      Check the current authentication status without logging in.
    `,
  )
  .option(
    "--with-pre-authenticated-keys",
    text`
      Authenticate using pre-authenticated keys. This is useful for CI/CD environments. You must
      also provide the --key-id, --public-key, and --private-key flags.
    `,
  )
  .option(
    "--key-id <value>",
    text`
      The key ID to use for authentication. You should supply this if and only if you are using
      --with-pre-authenticated-keys.
    `,
  )
  .option(
    "--public-key <value>",
    text`
      The public key to use for authentication. You should supply this if and only if you are
      using --with-pre-authenticated-keys.
    `,
  )
  .option(
    "--private-key <value>",
    text`
      The private key to use for authentication. You should supply this if and only if you are
      using --with-pre-authenticated-keys.
    `,
  );

addCreateClientOptions(loginCommand);
addLogLevelOptions(loginCommand);

loginCommand.action(async options => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);
  const {
    status = false,
    withPreAuthenticatedKeys = false,
    keyId,
    publicKey,
    privateKey,
  } = options;

  // Validate mutually exclusive options
  if (status && withPreAuthenticatedKeys) {
    throw new Error(text`
      The --status and --with-pre-authenticated-keys flags cannot be used together.
    `);
  }

  const authenticationStatus = normalizeAuthenticationStatus(
    await client.repository.getAuthenticationStatus(),
  );

  // Handle --status flag
  if (status) {
    logger.info(formatAuthenticationStatusMessage(authenticationStatus));
    return;
  }

  if (withPreAuthenticatedKeys) {
    if (authenticationStatus.type === "computeDevice") {
      throw makeCannotLoginWhileComputeDeviceError(authenticationStatus);
    }
    if (keyId === undefined || publicKey === undefined || privateKey === undefined) {
      throw new Error(text`
        You must provide --key-id, --public-key, and --private-key when using
        --with-pre-authenticated-keys.`);
    }
    const { userName } = await client.repository.loginWithPreAuthenticatedKeys({
      keyId,
      publicKey,
      privateKey,
    });
    logger.info(`Successfully logged in as ${userName}.`);
    return;
  } else {
    if (keyId !== undefined || publicKey !== undefined || privateKey !== undefined) {
      throw new Error(text`
        You must not provide --key-id, --public-key, or --private-key when not using
        --with-pre-authenticated-keys.`);
    }
  }
  switch (authenticationStatus.type) {
    case "loggedInUser":
      logger.info(`You are already authenticated as ${authenticationStatus.userName}.`);
      return;
    case "computeDevice":
      throw makeCannotLoginWhileComputeDeviceError(authenticationStatus);
    case "none":
      break;
    default: {
      const exhaustiveCheck: never = authenticationStatus;
      throw new Error(`Unexpected authentication status: ${exhaustiveCheck}`);
    }
  }
  await ensureAuthenticated(client, logger);
  logger.info("Authentication successful.");
});

export const login = loginCommand;
