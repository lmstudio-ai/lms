import { Command, type OptionValues } from "@commander-js/extra-typings";
import chalk from "chalk";
import {
  addCreateClientOptions,
  checkHttpServer,
  createClient,
  DEFAULT_SERVER_PORT,
  type CreateClientArgs,
} from "../createClient.js";
import { formatSizeBytes1000 } from "../formatBytes.js";
import { t } from "../i18n/index.js";
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
  .description(t("Prints the status of LM Studio"));

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
    content += t("Server: {status} (port: {port})", {
      status: chalk.green(t("ON")),
      port,
    });
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
      content += t("No Models Loaded");
    } else {
      content += t("Loaded Models");
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
    content += t("Server: {status}\n\n{hint}\n\n    lms server start", {
      status: chalk.red(t("OFF")),
      hint: chalk.dim(t("(i) To start the server, run the following command:")),
    });
  }
  console.info(content);
});

export const status = statusCommand;
