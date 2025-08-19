import { Command } from "@commander-js/extra-typings";
import { type DiagnosticsLogEventData } from "@lmstudio/lms-shared-types";
import chalk from "chalk";
import { addCreateClientOptions, createClient } from "../createClient.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";

const stream = addLogLevelOptions(
  addCreateClientOptions(
    new Command()
      .name("stream")
      .description("Stream logs from LM Studio")
      .option("--json", "Outputs in JSON format, separated by newline"),
  ),
).action(async options => {
  const logger = createLogger(options);
  const client = await createClient(logger, options);
  const { json = false } = options;

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
});

function printLlmPredictionLogEvent(
  data: DiagnosticsLogEventData & { type: "llm.prediction.input" },
) {
  console.log("modelIdentifier: " + chalk.greenBright(data.modelIdentifier));
  console.log("modelPath: " + chalk.greenBright(data.modelPath));
  console.log(`input: "${chalk.green(data.input)}"`);
}

export const log = new Command()
  .name("log")
  .description(
    "Log operations. Currently only supports streaming logs from LM Studio via `lms log stream`",
  )
  .addCommand(stream);
