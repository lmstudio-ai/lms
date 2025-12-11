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

  // Check if we are indeed trying to download a model
  const plan = downloadPlanner.getPlan();
  if (plan.nodes.length === 0) {
    throw new Error(`No downloadable content found for model ${owner}/${name}.`);
  }

  const rootNode = downloadPlanner.getPlan().nodes[0];
  if (rootNode.type !== "artifact") {
    throw new Error(`Expected root node to be an artifact for model ${owner}/${name}.`);
  }
  if (rootNode.artifactType !== "model") {
    throw new Error(
      `Expected artifact type to be 'model' but got '${rootNode.artifactType}' for model ${owner}/${name}.`,
    );
  }
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
