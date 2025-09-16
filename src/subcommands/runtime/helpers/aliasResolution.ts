import { ModelFormatName, RuntimeEngineInfo } from "@lmstudio/lms-shared-types";
import { compareVersions } from "../../../compareVersions.js";
import { UserInputError } from "../../../types/UserInputError.js";
import { AliasField, BuiltAlias, generateFullAlias } from "./AliasGenerator.js";
import { AliasGroup } from "./AliasGroup.js";

/**
 * Resolves an alias to all matching runtime engines.
 * @param engineInfos - Array of runtime engine info to search through
 * @param alias - The alias string to resolve
 * @returns Object containing matching engines and the fields used in the alias
 */
export function resolveAlias(
  engineInfos: RuntimeEngineInfo[],
  alias: string,
): {
  engines: RuntimeEngineInfo[];
  fields: Set<AliasField>;
} {
  const groups = AliasGroup.createGroups(engineInfos);
  const allMatches: Array<{ engine: RuntimeEngineInfo; matchedAlias: BuiltAlias }> = [];

  // Collect matches from all groups
  for (const group of groups) {
    allMatches.push(...group.resolve(alias));
  }

  if (allMatches.length === 0) {
    throw new UserInputError("Alias not found: " + alias);
  }

  // Check for field consistency across matches
  // Is a sanity check b/c it should always be true, unless we change alias generation logic.
  const firstMatchFields = allMatches[0].matchedAlias.fields;
  for (const match of allMatches.slice(1)) {
    const setsEqual = (set1: Set<AliasField>, set2: Set<AliasField>): boolean => {
      return set1.size === set2.size && [...set1].every(item => set2.has(item));
    };

    if (!setsEqual(firstMatchFields, match.matchedAlias.fields)) {
      throw Error(
        `Component conflict for alias "${alias}": ` +
          `existing components [${Array.from(firstMatchFields).join(", ")}] ` +
          `differ from new components [${Array.from(match.matchedAlias.fields).join(", ")}]`,
      );
    }
  }

  return {
    engines: allMatches.map(match => match.engine),
    fields: firstMatchFields,
  };
}

/**
 * Resolves an alias to matching runtime engines filtered by supported model formats.
 * @param engineInfos - Array of runtime engine info to search through
 * @param alias - The alias string to resolve
 * @param modelFormats - Set of model formats that engines must support all of
 * @returns Object containing matching filtered engines and the fields used in the alias
 */
export function resolveAliasForModelFormats(
  engineInfos: RuntimeEngineInfo[],
  alias: string,
  modelFormats: Set<ModelFormatName>,
): {
  engines: RuntimeEngineInfo[];
  fields: Set<AliasField>;
} {
  const { engines, fields } = resolveAlias(engineInfos, alias);

  const filteredEngines = engines.filter(engine => {
    return [...modelFormats].every(format => engine.supportedModelFormatNames.includes(format));
  });

  if (filteredEngines.length === 0) {
    throw new UserInputError(
      "Alias '" +
        alias +
        "' does not match any engines that are compatible with model format(s) [" +
        [...modelFormats].join(",") +
        "].",
    );
  }

  return {
    engines: filteredEngines,
    fields,
  };
}

/**
 * Resolves an alias to a single unique runtime engine, throwing an error if ambiguous.
 * @param engineInfos - Array of runtime engine info to search through
 * @param alias - The alias string to resolve
 * @param modelFormats - Optional set of model formats that engines must support all of
 * @returns Object containing the unique engine and the fields used in the alias
 */
export function resolveUniqueAlias(
  engineInfos: RuntimeEngineInfo[],
  alias: string,
  modelFormats?: Set<ModelFormatName>,
): {
  engine: RuntimeEngineInfo;
  fields: Set<AliasField>;
} {
  const { engines, fields } = modelFormats
    ? resolveAliasForModelFormats(engineInfos, alias, modelFormats)
    : resolveAlias(engineInfos, alias);

  if (engines.length === 1) {
    return { engine: engines[0], fields };
  } else {
    throw new UserInputError(
      "Alias '" +
        alias +
        "' is ambiguous. Options are [" +
        engines.map(e => generateFullAlias(e).alias) +
        "].",
    );
  }
}

/**
 * Resolves an alias to the latest version of a runtime engine.
 * @param engineInfos - Array of runtime engine info to search through
 * @param alias - The alias string to resolve
 * @param modelFormats - Optional set of model formats that engines must support all of
 * @returns Object containing the latest version engine and the fields used in the alias
 */
export function resolveLatestAlias(
  engineInfos: RuntimeEngineInfo[],
  alias: string,
  modelFormats?: Set<ModelFormatName>,
): {
  engine: RuntimeEngineInfo;
  fields: Set<AliasField>;
} {
  const { engines, fields } = modelFormats
    ? resolveAliasForModelFormats(engineInfos, alias, modelFormats)
    : resolveAlias(engineInfos, alias);

  const engineNames = new Set([...engines].map(e => e.name));
  if (engineNames.size > 1) {
    throw new UserInputError(
      "Latest alias '" +
        alias +
        "' cannot disambiguate between engine names [" +
        [...engineNames].join(",") +
        "].",
    );
  }

  const sortedEngines = [...engines].sort((a, b) => compareVersions(a.version, b.version));
  return { engine: sortedEngines[sortedEngines.length - 1], fields };
}
