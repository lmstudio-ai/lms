import { makePrettyError, text, type SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import { checkHttpServer, getServerLastStatus } from "./subcommands/server";

export async function createClient(logger: SimpleLogger) {
  let port: number;
  try {
    const lastStatus = await getServerLastStatus(logger);
    port = lastStatus.port;
  } catch (e) {
    logger.debug("Failed to get last server status", e);
    port = 1234;
  }
  if (!(await checkHttpServer(logger, port))) {
    logger.errorWithoutPrefix(
      makePrettyError(text`
        ${chalk.redBright(text`
          LM Studio server is not running. To start the server, run the following command:
        `)}

            ${chalk.yellow("lms server start ")}${chalk.gray("[--port <PORT>] [--cors=true|false]")}
    `).message,
    );
    process.exit(1);
  }
  const baseUrl = `ws://127.0.0.1:${port}`;
  logger.debug(`Connecting to server with baseUrl ${port}`);
  return new LMStudioClient({
    baseUrl,
    logger,
  });
}
