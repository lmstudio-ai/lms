import {
  type ModelFormatName,
  type RuntimeEngineSpecifier,
  type SelectedRuntimeEngineMap,
} from "@lmstudio/sdk";

/**
 * Creates a unique string key from a runtime engine specifier.
 * @param engine - The runtime engine specifier
 * @returns A unique string key
 */
export function createEngineKey(engine: RuntimeEngineSpecifier): string {
  return `${engine.name}:${engine.version}`;
}

/**
 * Inverts the mapping from model format names to runtime engine specifiers.
 * @param selections - Mapping of model format names to runtime engine specifiers
 * @returns Map of engine keys to arrays of model format names
 */
export function invertSelections(
  selections: SelectedRuntimeEngineMap,
): Map<string, ModelFormatName[]> {
  const result = new Map<string, ModelFormatName[]>();

  for (const [modelFormatName, runtimeEngineSpecifier] of selections) {
    const engineKey = createEngineKey(runtimeEngineSpecifier);

    const existingFormats = result.get(engineKey);
    if (existingFormats) {
      // Add to existing array
      existingFormats.push(modelFormatName);
    } else {
      // Create new entry
      result.set(engineKey, [modelFormatName]);
    }
  }

  return result;
}
