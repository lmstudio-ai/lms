import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import chalk from "chalk";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { openUrl } from "../openUrl.js";

type LoginCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    withPreAuthenticatedKeys?: boolean;
    keyId?: string;
    publicKey?: string;
    privateKey?: string;
  };

const loginCommand = new Command<[], LoginCommandOptions>()
  .name("login")
  .description(text`Authenticate with LM Studio}`)
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
  const { withPreAuthenticatedKeys = false, keyId, publicKey, privateKey } = options;
  if (withPreAuthenticatedKeys) {
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
  let askedToAuthenticate = false;
  await client.repository.ensureAuthenticated({
    onAuthenticationUrl: async url => {
      askedToAuthenticate = true;

      try {
        await openUrl(url);
        logger.infoText`
          Opening browser for authentication...
          If a browser window does not open automatically, visit the following URL directly:
        `;
      } catch {
        logger.info("Please visit the following URL to authenticate:");
      }

      logger.info();
      logger.info(chalk.green(`    ${url}`));
      logger.info();
    },
  });
  if (!askedToAuthenticate) {
    logger.info("You are already authenticated.");
  } else {
    logger.info("Authentication successful.");
  }
});

export const login = loginCommand;
