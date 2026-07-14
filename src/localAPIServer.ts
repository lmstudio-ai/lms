import { type LoggerInterface } from "@lmstudio/lms-common";
import {
  tryFindLocalAPIServer as tryFindLocalAPIServerWithPreferredPort,
  type APIServerStatus,
} from "@lmstudio/lms-common-server";
import { readFileSync } from "fs";
import { apiServerInfoPath } from "./lmstudioPaths.js";

/**
 * Reads the preferred local API server port published by LM Studio.
 *
 * The file is only a discovery hint. `lms-common-server` still verifies `/lms-status` before using
 * the port and falls back to the legacy port scan when this returns null.
 */
export function readLocalAPIServerPort(infoFilePath: string = apiServerInfoPath): number | null {
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

/** Finds the current local API server using the published port before legacy discovery. */
export function tryFindLocalAPIServer(logger: LoggerInterface): Promise<APIServerStatus | null> {
  return tryFindLocalAPIServerWithPreferredPort(logger, readLocalAPIServerPort());
}
