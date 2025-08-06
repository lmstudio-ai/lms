import { text } from "@lmstudio/lms-common";
import boxen from "boxen";
import chalk from "chalk";
import { command } from "cmd-ts";
import { createClient, createClientArgs, checkHttpServer } from "../createClient.js";
import { formatSizeBytesWithColor1000 } from "../formatSizeBytes1000.js";
import { createLogger, logLevelArgs } from "../logLevel.js";
import { getServerConfig } from "./server.js";

export const status = command({
  name: "status",
  description: "Prints the status of LM Studio",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
  },
  async handler(args) {
    const logger = createLogger(args);
    let { host, port } = args;
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
        Server: ${chalk.bgGreenBright.black(" ON ")} (Port: ${chalk.yellowBright(port)})
      `;
      content += "\n\n";

      const client = await createClient(logger, args);
      const loadedModels = (
        await Promise.all([client.llm.listLoaded(), client.embedding.listLoaded()])
      ).flat();
      const downloadedModels = await client.system.listDownloadedModels();
      content += chalk.cyanBright("Loaded Models");
      if (loadedModels.length === 0) {
        content += "\n" + chalk.gray("  · No Models Loaded");
      } else {
        for (const model of loadedModels) {
          const sizeBytes = downloadedModels.find(m => m.path === model.path)?.sizeBytes;
          let sizeText = "";
          if (sizeBytes !== undefined) {
            sizeText = `${chalk.gray(" - ")}${formatSizeBytesWithColor1000(sizeBytes)}`;
          }
          content += "\n" + chalk.greenBright(`  · ${model.identifier}${sizeText}`);
        }
      }
    } else {
      content += text`
        Server: ${chalk.bgRedBright.black(" OFF ")}

        ${chalk.gray("\n(i) To start the server, run the following command:")}

            ${chalk.yellow("lms server start ")}
      `;
    }
    console.info(
      boxen(content, {
        margin: 1,
        padding: 1,
        borderColor: "greenBright",
        title: "Status",
      }),
    );
  },
});
