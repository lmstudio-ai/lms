import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type LinkCommandOptions, startLinkLoader } from "./shared.js";

const MAX_CONNECTION_WAIT_MS = 5000;
const POLL_INTERVAL_MS = 100;

export const enable = new Command<[], LinkCommandOptions>()
  .name("enable")
  .description("Enable LM Link on this device");

addCreateClientOptions(enable);
addLogLevelOptions(enable);

enable.action(async function () {
  const mergedOptions = this.optsWithGlobals();
  const logger = createLogger(mergedOptions);
  await using client = await createClient(logger, mergedOptions);
  let currentStatus = await client.repository.lmLink.status();
  const wasDisabled: boolean = currentStatus.issues.includes("deviceDisabled") === true;

  await client.repository.lmLink.setDisabled(false);
  currentStatus = await client.repository.lmLink.status();
  let message: string;
  if (wasDisabled) {
    message = "LM Link enabled.";
  } else {
    message = "LM Link is already enabled.";
  }

  if (currentStatus.issues.includes("notLoggedIn") === true) {
    message +=
      " However, LM Link cannot connect because you are not logged in. Use " +
      chalk.cyan("lms login") +
      " to login.";
    logger.info(message);
    return;
  }

  if (currentStatus.issues.includes("noAccess") === true) {
    message +=
      " However, you do not have access to LM Link. Visit " +
      chalk.cyan("https://lmstudio.ai/lm-link") +
      " to request access.";
    logger.info(message);
    return;
  }

  if (wasDisabled) {
    logger.info(message + " Connecting now...");
  } else {
    logger.info(message);
  }
  if (currentStatus.status !== "online" && currentStatus.issues.length === 0) {
    const stopLoader = startLinkLoader();
    try {
      // Poll status until online or max attempts
      let attempts = 0;
      const maxAttempts = MAX_CONNECTION_WAIT_MS / POLL_INTERVAL_MS;

      while (attempts < maxAttempts) {
        currentStatus = await client.repository.lmLink.status();
        if (currentStatus.status === "online" || currentStatus.issues.length > 0) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        attempts++;
      }
    } finally {
      stopLoader();
    }
  }

  // This should not happen but we still want to handle it just in case
  if (currentStatus.issues.includes("deviceDisabled") === true) {
    logger.error("Failed to enable LM Link on this device.");
    return;
  }

  if (wasDisabled === false) {
    logger.infoText`
      LM Link was already enabled on this device. Use ${chalk.cyan("lms link status")} to see its current status.
    `;
  } else {
    logger.infoText`
      You have re-enabled LM Link on this device. Use ${chalk.cyan("lms link status")} to see its current status.
    `;
  }
});
