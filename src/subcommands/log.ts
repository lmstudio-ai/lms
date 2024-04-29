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
        const better = {
          ...log,
          timestamp: new Date(log.timestamp).toISOString(),
        };
        console.log(better);
      }
    });
  },
});

export const log = subcommands({
  name: "log",
  description:
    "Log operations. Currently only supports streaming logs from LM Studio via `lms log stream`",
  cmds: {
    stream,
  },
});
