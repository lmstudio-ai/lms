import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import { type DownloadableRuntimeExtensionInfo } from "@lmstudio/lms-shared-types";
import chalk from "chalk";
import { compareVersions } from "../../../compareVersions.js";
import { handleDownloadWithProgressBar } from "../../../handleDownloadWithProgressBar.js";

export type RuntimeExtensionsSearchOptions = Parameters<
  LMStudioClient["runtime"]["extensions"]["search"]
>[1];

export function buildRuntimeExtensionsSearchOptions(
  channelOverride: "stable" | "beta" | undefined,
  includeIncompatible: boolean,
): RuntimeExtensionsSearchOptions {
  if (channelOverride !== undefined) {
    return {
      channel: channelOverride,
      includeIncompatible,
    };
  }
  if (includeIncompatible === true) {
    return {
      channel: "stable",
      includeIncompatible: true,
    };
  }
  return undefined;
}

export function determineLatestLocalVersion(
  localVersions: Array<string>,
): string | undefined {
  let latestLocalVersion: string | undefined = undefined;
  for (const localVersion of localVersions) {
    if (latestLocalVersion === undefined) {
      latestLocalVersion = localVersion;
      continue;
    }
    if (compareVersions(localVersion, latestLocalVersion) === 1) {
      latestLocalVersion = localVersion;
    }
  }
  return latestLocalVersion;
}

export function formatLatestLocalVersion(
  latestLocalVersion: string | undefined,
): string {
  if (latestLocalVersion === undefined) {
    return chalk.gray("-");
  }
  return latestLocalVersion;
}

export function formatRuntimeUpdateStatus(
  remoteVersion: string,
  latestLocalVersion: string | undefined,
): string {
  if (latestLocalVersion === undefined) {
    return chalk.gray("not installed");
  }
  const versionComparison = compareVersions(remoteVersion, latestLocalVersion);
  if (versionComparison === 1) {
    return chalk.keyword("orange")("update available");
  }
  return chalk.gray("up to date");
}

export type DownloadRuntimeExtensionResult = "downloaded" | "already-installed";

export async function downloadRuntimeExtensionWithHandling(
  logger: SimpleLogger,
  client: LMStudioClient,
  runtimeExtension: DownloadableRuntimeExtensionInfo,
): Promise<DownloadRuntimeExtensionResult> {
  try {
    await handleDownloadWithProgressBar(logger, async downloadOptions => {
      await client.runtime.extensions.download(
        {
          name: runtimeExtension.name,
          version: runtimeExtension.version,
        },
        {
          onProgress: downloadOptions.onProgress,
          onStartFinalizing: downloadOptions.onStartFinalizing,
          signal: downloadOptions.signal,
        },
      );
    });
    return "downloaded";
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("is already installed")
    ) {
      logger.info(
        chalk.white(
          runtimeExtension.name +
            "@" +
            runtimeExtension.version +
            " is already installed.",
        ),
      );
      return "already-installed";
    }
    throw error;
  }
}
