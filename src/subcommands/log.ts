import { type DiagnosticsLogEventData } from "@lmstudio/lms-shared-types";
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
        console.log("Time: " + chalk.greenBright(new Date(log.timestamp).toLocaleString()));
        console.log("Type: " + chalk.greenBright(log.data.type));
        switch (log.data.type) {
          case "llm.prediction": {
            printLlmPredictionLogEvent(log.data);
          }
        }
      }
    });
  },
});

function printLlmPredictionLogEvent(data: DiagnosticsLogEventData & { type: "llm.prediction" }) {
  console.log("Model Identifier: " + chalk.greenBright(data.modelIdentifier));
  console.log("Model Path: " + chalk.greenBright(data.modelPath));
  console.log(chalk.underline("Full Prompt"));
  console.log(chalk.cyanBright(data.input));
  console.log();
}

export const log = subcommands({
  name: "log",
  description:
    "Log operations. Currently only supports streaming logs from LM Studio via `lms log stream`",
  cmds: {
    stream,
  },
});
