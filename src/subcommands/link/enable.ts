import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type LinkCommandOptions, startLinkLoader } from "./shared.js";

const MAX_CONNECTION_WAIT_MS = 10000; // 10 seconds
const POLL_INTERVAL_MS = 100; // 100 ms

export const enable = new Command<[], LinkCommandOptions>()
  .name("enable")
  .description("Enable LM Link on this device");

addCreateClientOptions(enable);
addLogLevelOptions(enable);

enable.action(async function () {
  const mergedOptions = this.optsWithGlobals();
  const logger = createLogger(mergedOptions);
  await using client = await createClient(logger, mergedOptions);

  await client.repository.lmLink.setDisabled(false);
  let currentStatus = await client.repository.lmLink.status();

  // Check for blocking issues
  if (currentStatus.issues.includes("notLoggedIn")) {
    logger.info(
      "LM Link enabled, but you are not authenticated. Run " +
        chalk.cyan("lms login") +
        " to continue.",
    );
    return;
  }

  if (currentStatus.issues.includes("noAccess")) {
    logger.info(
      "LM Link enabled, but you do not have access. Visit " +
        chalk.cyan("https://lmstudio.ai/lm-link"),
    );
    return;
  }

  if (currentStatus.issues.includes("badVersion")) {
    const { isDaemon } = await client.system.getInfo();
    logger.infoText`
      LM Link is enabled. However, LM Link cannot connect because the protocol has updated. You need to update
      ${isDaemon ? "llmster" : "LM Studio"} to continue using LM Link.
    `;
    if (isDaemon) {
      logger.infoText`
        Run ${chalk.cyan("lms daemon update")} to update.
      `;
    }
    return;
  }

  // Already online
  if (currentStatus.status === "online") {
    logger.info("LM Link is enabled and online.");
    return;
  }

  // Need to connect
  if (currentStatus.issues.length === 0) {
    logger.info("LM Link enabled. Connecting...");
    const stopLoader = startLinkLoader();
    const initialLastErrorTimestamp =
      currentStatus.lastError !== undefined ? currentStatus.lastError.timestamp : undefined;
    let updatedLastError: { message: string; timestamp: number } | null = null;
    try {
      // Poll status until online or max attempts
      let attemptCount = 0;
      const maxAttempts = MAX_CONNECTION_WAIT_MS / POLL_INTERVAL_MS;

      while (attemptCount < maxAttempts) {
        currentStatus = await client.repository.lmLink.status();
        const lastError = currentStatus.lastError;
        if (currentStatus.status === "offline" && lastError !== undefined) {
          const lastErrorTimestamp = lastError.timestamp;
          if (
            initialLastErrorTimestamp === undefined ||
            lastErrorTimestamp !== initialLastErrorTimestamp
          ) {
            updatedLastError = lastError;
            break;
          }
        }
        if (currentStatus.status === "online" || currentStatus.issues.length > 0) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        attemptCount++;
      }
    } finally {
      stopLoader();
    }

    if (currentStatus.status === "online") {
      logger.info("LM Link is now online.");
    } else if (updatedLastError !== null) {
      logger.info(`Failed to connect: ${updatedLastError.message}`);
      logger.info(
        "LM Link will continue to retry connection in the background. Use " +
          chalk.cyan("lms link status") +
          " to check current status.",
      );
    } else {
      logger.info(
        "LM Link enabled but could not connect. Use " +
          chalk.cyan("lms link status") +
          " for details.",
      );
    }
  } else {
    // That means we still see it as disabled, which is unexpected. Error out just in case. This
    // should never happen since setDisabled should have thrown if it failed, but just in case.
    logger.error("Something went wrong enabling LM Link. Please try again");
  }
});
