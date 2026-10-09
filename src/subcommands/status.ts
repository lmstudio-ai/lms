import { Command, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import chalk from "chalk";
import {
  addCreateClientOptions,
  checkHttpServer,
  createClient,
  DEFAULT_SERVER_PORT,
  type CreateClientArgs,
} from "../createClient.js";
import { formatSizeBytes1000 } from "../formatBytes.js";
import { tryFindLocalAPIServer, type LocalAPIServer } from "../localAPIServer.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { getServerConfig } from "./server.js";

type StatusCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    json?: boolean;
  };

const statusCommand = new Command<[], StatusCommandOptions>()
  .name("status")
  .description("Prints the status of LM Studio");

addCreateClientOptions(statusCommand);
addLogLevelOptions(statusCommand);

// Keep the REST status and model queries on the same app without starting one for status checks.
statusCommand.action(async options => {
  const logger = createLogger(options);
  let { host, port } = options;
  if (host === undefined) {
    host = "127.0.0.1";
  }
  let localAPIServer: LocalAPIServer | undefined;
  if (port === undefined) {
    if (host === "127.0.0.1") {
      localAPIServer = (await tryFindLocalAPIServer({ logger })) ?? undefined;
      if (localAPIServer !== undefined) {
        try {
          port = (await getServerConfig(logger, localAPIServer))?.port;
        } catch (error) {
          logger.debug("Failed to read last status", error);
        }
      }
    } else {
      port = DEFAULT_SERVER_PORT;
    }
  }
  let content = "";
  if (port !== undefined && (await checkHttpServer(logger, port, host))) {
    content += text`
      Server: ${chalk.green("ON")} (port: ${port})
    `;
    content += "\n\n";

    await using client = await createClient(logger, options, { localAPIServer });
    const loadedModels = (
      await Promise.all([
        client.llm.listLoaded(),
        client.embedding.listLoaded(),
        client.decision.listLoaded(),
      ])
    ).flat();
    const downloadedModels = await client.system.listDownloadedModels();
    if (loadedModels.length === 0) {
      content += "No Models Loaded";
    } else {
      content += "Loaded Models";
      for (const model of loadedModels) {
        const sizeBytes = downloadedModels.find(m => m.path === model.path)?.sizeBytes;
        let sizeText = "";
        if (sizeBytes !== undefined) {
          sizeText = `${chalk.dim(" - ")}${chalk.dim(formatSizeBytes1000(sizeBytes))}`;
        }
        content += `\n  · ${model.identifier}${sizeText}`;
      }
    }
  } else {
    content += text`
      Server: ${chalk.red(" OFF ")}

      ${chalk.dim("(i) To start the server, run the following command:")}

          lms server start
    `;
  }
  console.info(content);
});

export const status = statusCommand;
