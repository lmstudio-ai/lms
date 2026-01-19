import { Command, Option, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import {
  type DiagnosticsLogEvent,
  type DiagnosticsLogEventData,
  type DiagnosticsLogRuntimeEventData,
} from "@lmstudio/lms-shared-types";
import chalk from "chalk";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";

type LogStreamOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    json?: boolean;
    stats?: boolean;
    source?: "model" | "server" | "runtime";
    filter?: string;
  };

const stream = new Command<[], LogStreamOptions>()
  .name("stream")
  .description("Stream logs from LM Studio")
  .option("--json", "Outputs in JSON format, separated by newline")
  .option("--stats", "Print prediction stats if available")
  .addOption(
    new Option("-s, --source <source>", "Source of logs: 'model', 'server', or 'runtime'")
      .default("model")
      .choices(["model", "server", "runtime"]),
  )
  .option("--filter <filter>", "Filter for model source: 'input', 'output'");

addCreateClientOptions(stream);
addLogLevelOptions(stream);

stream.action(async options => {
  const logger = createLogger(options);
  // We don't want to dispose the client immediately, instead of using 'using'
  // we'll dispose it when the process exits.
  const client = await createClient(logger, options);
  const { json = false, stats = false, source = "model", filter } = options;

  // Don't allow stats with non-model sources
  if (stats === true && (source === "server" || source === "runtime")) {
    logger.error("--stats can only be used with --source model");
    process.exit(1);
  }

  // Validate filter usage
  if (filter !== undefined && (source === "server" || source === "runtime")) {
    logger.error("--filter can only be used with --source model");
    process.exit(1);
  }

  // Handle default behavior and warnings
  let filterTypes: string[] = [];
  if (source === "model") {
    if (filter === undefined) {
      filterTypes = ["input", "output"];
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
  const unsubscribe = client.diagnostics.unstable_streamLogs(log => {
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

  // Handle cleanup on exit
  process.on("SIGINT", async () => {
    unsubscribe();
    await client[Symbol.asyncDispose]();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    unsubscribe();
    await client[Symbol.asyncDispose]();
    process.exit(0);
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

  if (source === "runtime") {
    return log.data.type === "runtime.log";
  }

  return true;
}

function printFormattedLog(log: DiagnosticsLogEvent, stats: boolean): void {
  if (log.data.type === "server.log") {
    console.log(log.data.content);
    return;
  }

  if (log.data.type === "runtime.log") {
    printRuntimeLogEvent(log.data);
    return;
  }

  console.log("timestamp: " + chalk.green(new Date(log.timestamp).toLocaleString()));
  console.log("type: " + chalk.green(log.data.type));
  printLlmPredictionLogEvent(log.data, stats);
  console.log();
  console.log();
}

function printRuntimeLogEvent(data: DiagnosticsLogRuntimeEventData): void {
  const engineDescriptor = `${data.engineName}@${data.engineVersion}`;
  const modelDescriptor = data.modelIdentifier !== undefined ? ` ${data.modelIdentifier}` : "";
  const pidDescriptor = data.pid !== undefined ? ` pid=${data.pid}` : "";
  const header = `[${data.level.toUpperCase()}] ${engineDescriptor} (${data.engineType})${modelDescriptor}${pidDescriptor}`;
  console.log(`${header} ${data.message}`);
}

function printLlmPredictionLogEvent(data: DiagnosticsLogEventData, stats: boolean) {
  if (data.type === "server.log" || data.type === "runtime.log") return;
  console.log("modelIdentifier: " + chalk.green(data.modelIdentifier));
  if (data.type === "llm.prediction.input") {
    console.log("modelPath: " + chalk.green(data.modelPath));
    console.log("input:");
    console.log(chalk.green(data.input));
  }
  if (data.type === "llm.prediction.output") {
    console.log("output:");
    console.log(chalk.green(data.output));
    if (stats === true) {
      if (data.stats !== undefined) {
        Object.entries(data.stats).forEach(([key, value]) => {
          console.log(`${key}: ${chalk.green(value)}`);
        });
      } else {
        console.log("No stats available");
      }
    }
  }
}

export const log = new Command()
  .name("log")
  .description("Log incoming and outgoing messages")
  .addCommand(stream);
