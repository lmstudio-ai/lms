import { Command, Option } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { type DiagnosticsLogEvent, type DiagnosticsLogEventData } from "@lmstudio/lms-shared-types";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../createClient.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";

const stream = addLogLevelOptions(
  addCreateClientOptions(
    new Command()
      .name("stream")
      .description("Stream logs from LM Studio")
      .option("--json", "Outputs in JSON format, separated by newline")
      .option("--stats", "Print prediction stats if available")
      .addOption(
        new Option("--source <source>", "Source of logs: 'model' or 'server'")
          .default("model")
          .choices(["model", "server"]),
      )
      .option("--filter <filter>", "Filter for model source: 'input', 'output'"),
  ),
).action(async options => {
  const logger = createLogger(options);
  const client = await createClient(logger, options);
  const { json = false, stats = false, source = "model", filter } = options;

  // Don't allow stats with server source
  if (stats === true && source === "server") {
    logger.error("--stats can only be used with --source model");
    process.exit(1);
  }

  // Validate filter usage
  if (filter !== undefined && source === "server") {
    logger.error("--filter can only be used with --source model");
    process.exit(1);
  }

  // Handle default behavior and warnings
  let filterTypes: string[] = [];
  if (source === "model") {
    if (filter === undefined) {
      // Default behavior with warning
      filterTypes = ["input"];
      logger.warn(
        text`
          WARNING: 'lms log stream' will show both user and assistant messages in future versions.
          To continue seeing only user messages, please use 'lms log stream --source model --filter
          input'
        `,
      );
    } else {
      // Check for empty string
      if (filter.trim() === "") {
        logger.error("--filter cannot be empty");
        process.exit(1);
      }
      // Parse filter
      filterTypes = filter
        .split(",")
        .map((f: string) => f.trim())
        .filter(f => f.length > 0);
      for (const type of filterTypes) {
        if (type !== "input" && type !== "output") {
          logger.error("--filter values must be 'input', 'output', or 'input,output'");
          process.exit(1);
        }
      }
    }
  }

  logger.info("Streaming logs from LM Studio\n");

  client.diagnostics.unstable_streamLogs(log => {
    // Here we consume the same stream for both model and server logs and filter based on user input
    if (!shouldShowLogEvent(log, source, filterTypes)) {
      return;
    }

    if (json) {
      console.log(JSON.stringify(log));
    } else {
      printFormattedLog(log, stats);
    }
  });
});

function shouldShowLogEvent(
  log: DiagnosticsLogEvent,
  source: string,
  filterTypes: string[],
): boolean {
  if (source === "model") {
    if (filterTypes.length > 0) {
      return filterTypes.some(type => log.data.type === `llm.prediction.${type}`);
    }
    return log.data.type.startsWith("llm.prediction.");
  }

  if (source === "server") {
    return log.data.type === "server.log";
  }

  return true;
}

function printFormattedLog(log: DiagnosticsLogEvent, stats: boolean): void {
  if (log.data.type === "server.log") {
    console.log(log.data.content);
    return;
  }

  console.log("timestamp: " + chalk.greenBright(new Date(log.timestamp).toLocaleString()));
  console.log("type: " + chalk.greenBright(log.data.type));
  printLlmPredictionLogEvent(log.data, stats);
  console.log();
  console.log();
}

function printLlmPredictionLogEvent(data: DiagnosticsLogEventData, stats: boolean) {
  if (data.type === "server.log") return;
  console.log("modelIdentifier: " + chalk.greenBright(data.modelIdentifier));
  if (data.type === "llm.prediction.input") {
    console.log("modelPath: " + chalk.greenBright(data.modelPath));
  }
  if (data.type === "llm.prediction.input") {
    console.log("input:");
    console.log(chalk.greenBright(data.input));
  }
  if (data.type === "llm.prediction.output") {
    console.log("output:");
    console.log(chalk.greenBright(data.output));
    if (stats === true) {
      if (data.stats !== undefined) {
        Object.entries(data.stats).forEach(([key, value]) => {
          console.log(`${key}: ${chalk.greenBright(value)}`);
        });
      } else {
        console.log("No stats available");
      }
    }
  }
}

export const log = new Command()
  .name("log")
  .description(
    "Log operations. Currently only supports streaming logs from LM Studio via `lms log stream`",
  )
  .addCommand(stream);
