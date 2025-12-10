import { type LMStudioClient } from "@lmstudio/sdk";
import { formatSizeBytes1000 } from "../../formatSizeBytes1000.js";

export interface DownloadProgressCallbacks {
  onComplete?: (owner: string, name: string) => void;
  onError?: (error: Error | unknown) => void;
}

/**
 * Resolves the download size for a model without starting the download.
 */
export async function getDownloadSize(
  client: LMStudioClient,
  owner: string,
  name: string,
): Promise<number> {
  using downloadPlanner = client.repository.createArtifactDownloadPlanner({
    owner,
    name,
  });
  await downloadPlanner.untilReady();
  const plan = downloadPlanner.getPlan();
  return plan.downloadSizeBytes;
}

/**
 * Downloads a model with progress tracking. Callbacks are invoked at 10% increments,
 * during finalization, on completion, and on error.
 */
export async function downloadModelWithProgress(
  client: LMStudioClient,
  owner: string,
  name: string,
  callbacks: DownloadProgressCallbacks = {},
): Promise<void> {
  using downloadPlanner = client.repository.createArtifactDownloadPlanner({
    owner,
    name,
  });
  await downloadPlanner.untilReady();

  let lastLoggedPercentage = 0;

  try {
    await downloadPlanner.download({
      onProgress: update => {
        if (update.totalBytes <= 0) {
          return;
        }
        const percentage = Math.floor((update.downloadedBytes / update.totalBytes) * 100);
        if (percentage === 100 || percentage - lastLoggedPercentage >= 10) {
          lastLoggedPercentage = percentage;
        }
      },
    });
    callbacks.onComplete?.(owner, name);
  } catch (error) {
    callbacks.onError?.(error);
    throw error;
  }
}

/**
 * Formats download progress into a human-readable string.
 */
export function formatDownloadProgress(
  owner: string,
  name: string,
  percentage: number,
  downloadedBytes: number,
  totalBytes: number,
): string {
  return `Downloading ${owner}/${name}: ${percentage}% (${formatSizeBytes1000(downloadedBytes)} / ${formatSizeBytes1000(totalBytes)})`;
}
