import { type SimpleLogger } from "@lmstudio/lms-common";
import type { HubModel } from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";

let fetchedModelCatalogCache: HubModel[] | null = null;
/**
 * Fetches the model catalog from the repository. Returns an empty array if offline
 * or if the fetch fails.
 */
export async function fetchModelCatalog(
  client: LMStudioClient,
  logger?: SimpleLogger,
): Promise<HubModel[]> {
  try {
    if (fetchedModelCatalogCache !== null) {
      return fetchedModelCatalogCache;
    }
    const modeCatalog = await client.repository.unstable.getModelCatalog();
    fetchedModelCatalogCache = modeCatalog;
    return modeCatalog;
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("network") === true) {
      logger?.warn("Offline, unable to fetch model catalog");
    } else {
      logger?.error("Error fetching model catalog:", error);
    }
    return [];
  }
}

/**
 * Finds a model in the catalog by owner/name identifier.
 * The search is case-insensitive.
 */
export function findModelInCatalog(catalog: HubModel[], identifier: string): HubModel | undefined {
  const normalizedIdentifier = identifier.toLowerCase();
  return catalog.find(
    catalogModel =>
      `${catalogModel.owner}/${catalogModel.name}`.toLowerCase() === normalizedIdentifier,
  );
}

/**
 * Parses a model identifier in the format "owner/name" and returns the components.
 * Returns null if the format is invalid.
 */
export function parseModelIdentifier(identifier: string): { owner: string; name: string } | null {
  const trimmedIdentifier = identifier.trim();
  const separatorIndex = trimmedIdentifier.indexOf("/");

  if (separatorIndex === -1) {
    return null;
  }

  const owner = trimmedIdentifier.slice(0, separatorIndex).trim();
  const name = trimmedIdentifier.slice(separatorIndex + 1).trim();

  if (owner.length === 0 || name.length === 0) {
    return null;
  }

  return { owner, name };
}
