import { DiagnosticsLogEventData } from "@lmstudio/lms-shared-types";
import { execSync } from "child_process";

// ...

npm install @lmstudio/lms-shared-types

// ...
import chalk from "chalk";
import { command, flag, subcommands } from "cmd-ts";
import { createClient, createClientArgs } from "../createClient";
import { createLogger, logLevelArgs } from "../logLevel";

const stream = command({
  name: "stream",
  description: "Stream logs from LM Studio",
  args: {
    json: flag({
      long: "json",
      description: "Outputs in JSON format, separated by newline",
    }),
    ...logLevelArgs,
    ...createClientArgs,
  },
  async handler(args) {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    const { json } = args;

    logger.info("Streaming logs from LM Studio\n");

    client.diagnostics.unstable_streamLogs(log => {
      if (json) {
        console.log(JSON.stringify(log));
      } else {
        console.log("timestamp: " + chalk.greenBright(new Date(log.timestamp).toLocaleString()));
        console.log("type: " + chalk.greenBright(log.data.type));
        switch (log.data.type) {
          case "llm.prediction.input": {
            printLlmPredictionLogEvent(log.data);
          }
        }
        console.log();
        console.log();
      }
    });
  },
});

function printLlmPredictionLogEvent(
  data: DiagnosticsLogEventData & { type: "llm.prediction.input" },
) {
  console.log("modelIdentifier: " + chalk.greenBright(data.modelIdentifier));
  console.log("modelPath: " + chalk.greenBright(data.modelPath));
  console.log(`input: "${chalk.green(data.input)}"`);
}

export const log = subcommands({
  name: "log",
  description:
    "Log operations. Currently only supports streaming logs from LM Studio via `lms log stream`",
  cmds: {
    stream,
  },
});
import chalk from "chalk";
import { command, flag, subcommands } from "cmd-ts";
import { createClient, createClientArgs } from "../createClient";
import { createLogger, logLevelArgs } from "../logLevel";

const stream = command({
  name: "stream",
  description: "Stream logs from LM Studio",
  args: {
    json: flag({
      long: "json",
      description: "Outputs in JSON format, separated by newline",
    }),
    ...logLevelArgs,
    ...createClientArgs,
  },
  async handler(args) {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    const { json } = args;

    logger.info("Streaming logs from LM Studio\n");

    client.diagnostics.unstable_streamLogs(log => {
      if (json) {
        console.log(JSON.stringify(log));
      } else {
        console.log("timestamp: " + chalk.greenBright(new Date(log.timestamp).toLocaleString()));
        console.log("type: " + chalk.greenBright(log.data.type));
        switch (log.data.type) {
          case "llm.prediction.input": {
            printLlmPredictionLogEvent(log.data);
          }
        }
        console.log();
        console.log();
      }
    });
  },
});

function printLlmPredictionLogEvent(
  data: DiagnosticsLogEventData & { type: "llm.prediction.input" },
) {
  console.log("modelIdentifier: " + chalk.greenBright(data.modelIdentifier));
  console.log("modelPath: " + chalk.greenBright(data.modelPath));
  console.log(`input: "${chalk.green(data.input)}"`);
}

export const log = subcommands({
  name: "log",
  description:
    "Log operations. Currently only supports streaming logs from LM Studio via `lms log stream`",
  cmds: {
    stream,
  },
});
