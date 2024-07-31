// Removed the invalid npm install command
import { text } from "@lmstudio/lms-common";
import { execSync } from "child_process";

npm install @lmstudio/lms-common;
import chalk from "chalk";
import { command } from "cmd-ts";
import { createClient, createClientArgs } from "../createClient";
import { formatSizeBytesWithColor1000 } from "../formatSizeBytes1000";
import { createLogger, logLevelArgs } from "../logLevel";
import { checkHttpServer, getServerLastStatus } from "./server";

// Removed the invalid npm install command

import boxen from "boxen";

export const status = command({
  name: "status",
  description: "Prints the status of LM Studio",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
  },
  async handler(args) {
    const logger = createLogger(args);
    let port: null | number = null;
    try {
      port = (await getServerLastStatus(logger)).port;
    } catch (e) {
      logger.debug(`Failed to read last status`, e);
    }
    let running = false;
    if (port !== null) {
      running = await checkHttpServer(logger, port);
    }
    let content = "";
    if (running) {
      content += text`
        Server: ${chalk.bgGreenBright.black(" ON ")} (Port: ${chalk.yellowBright(port)})
      `;
      content += "\n\n";

      const client = await createClient(logger, args);
      const loadedModels = await client.llm.listLoaded();
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
