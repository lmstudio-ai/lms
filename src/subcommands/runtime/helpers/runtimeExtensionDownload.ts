import { type SimpleLogger } from "@lmstudio/lms-common";
import { type DownloadableRuntimeExtensionInfo } from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import { compareVersions } from "../../../compareVersions.js";
import { handleDownloadWithProgressBar } from "../../../handleDownloadWithProgressBar.js";
import { t } from "../../../i18n/index.js";

export function determineLatestLocalVersion(localVersions: Array<string>): string | undefined {
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

export function formatLatestLocalVersion(latestLocalVersion: string | undefined): string {
  if (latestLocalVersion === undefined) {
    return chalk.dim("-");
  }
  return latestLocalVersion;
}

export function formatRuntimeUpdateStatus(
  remoteVersion: string,
  latestLocalVersion: string | undefined,
): string {
  if (latestLocalVersion === undefined) {
    return chalk.dim(t("not installed"));
  }
  const versionComparison = compareVersions(remoteVersion, latestLocalVersion);
  if (versionComparison > 0) {
    return chalk.yellow(t("update available"));
  } else if (versionComparison < 0) {
    return chalk.yellow(t("newer version installed"));
  } else {
    return chalk.dim("up-to-date");
  }
}

export type DownloadRuntimeExtensionResult = "downloaded" | "already-installed";

export async function downloadRuntimeExtensionWithErrorHandling(
  logger: SimpleLogger,
  client: LMStudioClient,
  runtimeExtension: DownloadableRuntimeExtensionInfo,
  { updateSelections }: { updateSelections: boolean },
): Promise<DownloadRuntimeExtensionResult> {
  try {
    await handleDownloadWithProgressBar(
      logger,
      async downloadOptions => {
        await client.runtime.extensions.download(
          {
            name: runtimeExtension.name,
            version: runtimeExtension.version,
          },
          {
            updateSelections,
            onProgress: downloadOptions.onProgress,
            onStartFinalizing: downloadOptions.onStartFinalizing,
            signal: downloadOptions.signal,
          },
        );
      },
      // After the download, the server extracts and sets up the runtime, which can take minutes.
      {
        finalizingMessage: t("Installing runtime... (this might take a while)"),
        completedMessage: t("Runtime installed."),
      },
    );
    return "downloaded";
  } catch (error) {
    if (error instanceof Error && error.message.includes("is already installed")) {
      logger.info(
        t(`{p0}@{p1} is already installed.`, {
          p0: runtimeExtension.name,
          p1: runtimeExtension.version,
        }),
      );
      return "already-installed";
    }
    throw error;
  }
}
