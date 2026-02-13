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
  // Check for blocking issues first
  if (currentStatus.issues.includes("notLoggedIn") === true) {
    const prefix = wasDisabled ? "LM Link enabled." : "LM Link is already enabled.";
    logger.info(
      prefix +
        " However, LM Link cannot connect because you are not logged in. Use " +
        chalk.cyan("lms login") +
        " to login.",
    );
    return;
  }

  if (currentStatus.issues.includes("noAccess") === true) {
    const prefix = wasDisabled ? "LM Link enabled." : "LM Link is already enabled.";
    logger.info(
      prefix +
        " However, you do not have access to LM Link. Visit " +
        chalk.cyan("https://lmstudio.ai/lm-link") +
        " to request access.",
    );
    return;
  }

  if (currentStatus.issues.includes("badVersion") === true) {
    const prefix = wasDisabled ? "LM Link enabled." : "LM Link is already enabled.";
    const { isDaemon } = await client.system.getInfo();
    logger.infoText`
      ${prefix} However, LM Link cannot connect because the protocol has updated. You need to update
      ${isDaemon ? "llmster" : "LM Studio"} to continue using LM Link.
    `;
    if (isDaemon) {
      logger.infoText`
        Run ${chalk.cyan("lms daemon update")} to update.
      `;
    }
    return;
  }

  // No blocking issues
  if (wasDisabled) {
    logger.info("LM Link enabled. Connecting now...");
  } else {
    logger.info("LM Link is already enabled.");
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
