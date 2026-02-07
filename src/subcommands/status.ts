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

statusCommand.action(async options => {
  const logger = createLogger(options);
  let { host, port } = options;
  if (host === undefined) {
    host = "127.0.0.1";
  }
  if (port === undefined) {
    if (host === "127.0.0.1") {
      try {
        port = (await getServerConfig(logger))?.port ?? DEFAULT_SERVER_PORT;
      } catch (e) {
        logger.debug(`Failed to read last status`, e);
        port = DEFAULT_SERVER_PORT;
      }
    } else {
      port = DEFAULT_SERVER_PORT;
    }
  }
  const running = await checkHttpServer(logger, port, host);
  let content = "";
  if (running) {
    content += text`
      Server: ${chalk.green("ON")} (port: ${port})
    `;
    content += "\n\n";

    await using client = await createClient(logger, options);
    const loadedModels = (
      await Promise.all([client.llm.listLoaded(), client.embedding.listLoaded()])
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
