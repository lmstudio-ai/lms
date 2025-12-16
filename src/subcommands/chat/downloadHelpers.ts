import { type LMStudioClient } from "@lmstudio/sdk";

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
