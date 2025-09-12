import { RuntimeEngineInfo } from "../../../../lms-shared-types/dist/types/RuntimeEngine.js";
import { compareVersions } from "../../compareVersions.js";
import { AliasField, BuiltAlias, fallbackAlias } from "./aliasGeneration.js";
import { AliasGroup } from "./aliasGrouping.js";
import { UserInputError } from "./UserInputError.js";

// Returns list of all matching engines
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

// Returns list of matching engines filtered by model formats
export function resolveAliasForModelFormats(
  engineInfos: RuntimeEngineInfo[],
  alias: string,
  modelFormats: Set<string>,
): {
  engines: RuntimeEngineInfo[];
  fields: Set<AliasField>;
} {
  const { engines, fields } = resolveAlias(engineInfos, alias);

  const filteredEngines = engines.filter(engine => {
    // Check if engine supports ALL requested formats
    return [...modelFormats].every(format => engine.supportedModelFormats.includes(format));
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

// Returns single engine (must be unambiguous)
export function resolveUniqueAlias(
  engineInfos: RuntimeEngineInfo[],
  alias: string,
  modelFormats?: Set<string>,
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
        engines.map(e => fallbackAlias(e).alias) +
        "].",
    );
  }
}

// Returns latest version engine
export function resolveLatestAlias(
  engineInfos: RuntimeEngineInfo[],
  alias: string,
  modelFormats?: Set<string>,
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
