import { Command } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import chalk from "chalk";
import { addCreateClientOptions, checkHttpServer, createClient } from "../createClient.js";
import { formatSizeBytes1000 } from "../formatSizeBytes1000.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";
import { getServerConfig } from "./server.js";
import { EnvironmentManager } from "../EnvironmentManager.js";

export const status = addLogLevelOptions(
  addCreateClientOptions(
    new Command().name("status").description("Prints the status of LM Studio"),
  ),
).action(async options => {
  const logger = createLogger(options);
  const envManager = new EnvironmentManager(logger, options);
  const currentEnv = await envManager.getCurrentEnvironment();
  let host = currentEnv.host;
  let port = currentEnv.port;

  if (host === undefined) {
    host = "127.0.0.1";
  }
  if (port === undefined) {
    if (host === "127.0.0.1") {
      try {
        port = (await getServerConfig(logger)).port;
      } catch (e) {
        logger.debug(`Failed to read last status`, e);
        port = 1234;
      }
    } else {
      port = 1234;
    }
  }
  const running = await checkHttpServer(logger, port, host);
  let content = "";
  if (running) {
    content += text`
      Server: ${chalk.greenBright("ON")} (port: ${port})
    `;
    content += "\n\n";

    const client = await createClient(logger, options);
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
          sizeText = `${chalk.gray(" - ")}${chalk.gray(formatSizeBytes1000(sizeBytes))}`;
        }
        content += `\n  · ${model.identifier}${sizeText}`;
      }
    }
  } else {
    content += text`
      Server: ${chalk.redBright(" OFF ")}

      ${chalk.gray("(i) To start the server, run the following command:")}

          lms server start
    `;
  }
  console.info(content);
});
