import { type SimpleLogger } from "@lmstudio/lms-common";
import type { HubModel } from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";

let cachedCatalogPromise: Promise<HubModel[]> | null = null;
/**
 * Fetches the model catalog from the repository. Returns an empty array if offline
 * or if the fetch fails.
 */
export async function getCachedModelCatalogOrFetch(
  client: LMStudioClient,
  logger?: SimpleLogger,
): Promise<HubModel[]> {
  try {
    if (cachedCatalogPromise !== null) {
      return await cachedCatalogPromise;
    }
    cachedCatalogPromise = client.repository.unstable.getModelCatalog();
    return await cachedCatalogPromise;
  } catch (error) {
    // Clear the cached promise on failure so that subsequent calls will retry
    cachedCatalogPromise = null;
    if (error instanceof Error && error.message.toLowerCase().includes("network") === true) {
      logger?.warn("Offline, unable to fetch model catalog");
    } else {
      logger?.error("Error fetching model catalog:", error);
    }
    return [];
  }
}

/**
 * Finds a model in the catalog by owner/name
 * The search is case-insensitive.
 */
export function findModelInCatalog(catalog: HubModel[], modelKey: string): HubModel | undefined {
  const normalizedModelKey = modelKey.toLowerCase();
  return catalog.find(
    catalogModel =>
      `${catalogModel.owner}/${catalogModel.name}`.toLowerCase() === normalizedModelKey,
  );
}

/**
 * Parses a modelKey in the format "owner/name" and returns the components.
 * Returns null if the format is invalid.
 */
export function parseModelKey(modelKey: string): { owner: string; name: string } | null {
  const trimmedModelKey = modelKey.trim();
  const separatorIndex = trimmedModelKey.indexOf("/");

  if (separatorIndex === -1) {
    return null;
  }

  const owner = trimmedModelKey.slice(0, separatorIndex).trim();
  const name = trimmedModelKey.slice(separatorIndex + 1).trim();

  if (owner.length === 0 || name.length === 0) {
    return null;
  }

  return { owner, name };
}
