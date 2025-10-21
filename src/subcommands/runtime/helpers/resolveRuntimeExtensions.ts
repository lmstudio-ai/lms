import { type RuntimeEngineInfo } from "@lmstudio/sdk";

/**
 * Given a specifier string, determines if it specifies a version.
 */
export function doesSpecifierStringSpecifyVersion(specifierString: string): boolean {
  return specifierString.includes("@");
}

/**
 * Supported syntax:
 *
 * - `name@version` to specify a specific version
 * - `name` to specify all versions with that name
 */
export function resolveMultipleRuntimeExtensions(
  runtimeExtensions: Array<RuntimeEngineInfo>,
  specifierString: string,
): Array<RuntimeEngineInfo> {
  if (specifierString.includes("@")) {
    const [namePart, versionPart] = specifierString.split("@");
    return runtimeExtensions.filter(ext => ext.name === namePart && ext.version === versionPart);
  } else {
    return runtimeExtensions.filter(ext => ext.name === specifierString);
  }
}
