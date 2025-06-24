import { text } from "@lmstudio/lms-common";
import chalk from "chalk";
import { boolean, command, flag, option, optional, string } from "cmd-ts";
import { createClient, createClientArgs } from "../createClient.js";
import { createLogger, logLevelArgs } from "../logLevel.js";
import { openUrl } from "../openUrl.js";

export const login = command({
  name: "login",
  description: "Authenticate with LM Studio",
  args: {
    withPreAuthenticatedKeys: flag({
      type: boolean,
      long: "with-pre-authenticated-keys",
      description: text`
        Authenticate using pre-authenticated keys. This is useful for CI/CD environments. You must
        also provide the --key-id, --public-key, and --private-key flags.
      `,
    }),
    keyId: option({
      type: optional(string),
      long: "key-id",
      description: text`
        The key ID to use for authentication. You should supply this if and only if you are using
        --with-pre-authenticated-keys.
      `,
    }),
    publicKey: option({
      type: optional(string),
      long: "public-key",
      description: text`
        The public key to use for authentication. You should supply this if and only if you are
        using --with-pre-authenticated-keys.
      `,
    }),
    privateKey: option({
      type: optional(string),
      long: "private-key",
      description: text`
        The private key to use for authentication. You should supply this if and only if you are
        using --with-pre-authenticated-keys.
      `,
    }),
    ...logLevelArgs,
    ...createClientArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    const { withPreAuthenticatedKeys, keyId, publicKey, privateKey } = args;
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
      onAuthenticationUrl: url => {
        askedToAuthenticate = true;
        logger.info("Opening browser for authentication... If a browser window does not open automatically, visit the following URL directly:");
        logger.info();
        logger.info(chalk.greenBright(`    ${url}`));
        logger.info();

        try {
          openUrl(url);
        } catch {
          // ignore error
        }
      },
    });
    if (!askedToAuthenticate) {
      logger.info("You are already authenticated.");
    } else {
      logger.info("Authentication successful.");
    }
  },
});
