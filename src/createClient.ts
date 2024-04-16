import { type SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import { getServerLastStatus } from "./subcommands/server";

export async function createClient(logger: SimpleLogger) {
  let port: number;
  try {
    const lastStatus = await getServerLastStatus(logger);
    port = lastStatus.port;
  } catch (e) {
    logger.debug("Failed to get last server status", e);
    port = 1234;
  }
  const baseUrl = `ws://127.0.0.1:${port}`;
  logger.debug(`Connecting to server with baseUrl ${port}`);
  return new LMStudioClient({
    baseUrl,
    logger,
  });
}
