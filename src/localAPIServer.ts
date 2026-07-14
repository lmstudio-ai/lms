import { type LoggerInterface } from "@lmstudio/lms-common";
import {
  getLocalAPIServerStatusAtPortOrThrow,
  tryFindLocalAPIServer as tryFindLocalAPIServerWithPreferredPort,
  type APIServerStatus,
} from "@lmstudio/lms-common-server";
import { readFileSync } from "fs";
import { apiServerInfoPath } from "./lmstudioPaths.js";

/**
 * Reads the preferred local API server port published by LM Studio.
 *
 * `LMS_API_SERVER_INFO_PATH` selects one exact development instance. Without it, this remains a
 * discovery hint and callers retain the legacy port scan as a fallback.
 */
export function readLocalAPIServerPort(
  infoFilePath: string = process.env.LMS_API_SERVER_INFO_PATH ?? apiServerInfoPath,
): number | null {
  try {
    const info: unknown = JSON.parse(readFileSync(infoFilePath, "utf-8"));
    if (info === null || typeof info !== "object" || !("port" in info)) {
      return null;
    }
    const port = info.port;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return port;
  } catch {
    return null;
  }
}

/**
 * Finds the selected local API server.
 *
 * An explicit info-file override is strict so development wrappers cannot silently connect to a
 * different running app. Normal lms invocations keep the legacy discovery fallback.
 */
export async function tryFindLocalAPIServer(
  logger: LoggerInterface,
): Promise<APIServerStatus | null> {
  const port = readLocalAPIServerPort();
  if (process.env.LMS_API_SERVER_INFO_PATH === undefined) {
    return await tryFindLocalAPIServerWithPreferredPort(logger, port);
  }
  if (port === null) {
    logger.debug("The selected API server info file does not contain a valid port.");
    return null;
  }
  try {
    return await getLocalAPIServerStatusAtPortOrThrow(port, 3000);
  } catch (error) {
    logger.debug(`Failed to find the selected local API server on port ${port}:`, error);
    return null;
  }
}
