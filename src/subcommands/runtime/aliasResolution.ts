import { RuntimeEngineInfo } from "../../../../lms-shared-types/dist/types/RuntimeEngine.js";
import { compareVersions } from "../../compareVersions.js";
import { AliasField, fallbackAlias, generateAliases } from "./common.js";

function generateAliasMap(engines: RuntimeEngineInfo[]): Map<
  string,
  {
    engines: {
      name: string;
      version: string;
      supportedModelFormats: Set<string>;
    }[];
    fields: Set<AliasField>;
  }
> {
  const enginesAndAliases = engines.map(engine => {
    return {
      engine: {
        name: engine.name,
        version: engine.version,
        engine,
      },
      builtAliases: generateAliases(engine),
    };
  });
  // generateAliases does not include fallback aliases in its map, but we want to enable
  // CLI users to select via a fallback alias as well.
  enginesAndAliases.forEach(engineAndAliases =>
    engineAndAliases.builtAliases.push(fallbackAlias(engineAndAliases.engine)),
  );

  const aliasMap = new Map<
    string,
    {
      engines: {
        name: string;
        version: string;
        supportedModelFormats: Set<string>;
      }[];
      fields: Set<AliasField>;
    }
  >();

  const setsEqual = (set1: Set<AliasField>, set2: Set<AliasField>): boolean => {
    return set1.size === set2.size && [...set1].every(item => set2.has(item));
  };

  for (const { engine, builtAliases } of enginesAndAliases) {
    const supportedModelFormats = new Set(engine.engine.supportedModelFormats);
    for (const builtAlias of builtAliases) {
      const { alias, fields } = builtAlias;

      if (aliasMap.has(alias)) {
        const existingEntry = aliasMap.get(alias)!;

        if (!setsEqual(existingEntry.fields, fields)) {
          throw Error(
            `Component conflict for alias "${alias}": ` +
              `existing components [${Array.from(existingEntry.fields).join(", ")}] ` +
              `differ from new components [${Array.from(fields).join(", ")}]`,
          );
        }

        existingEntry.engines.push({ ...engine, supportedModelFormats });
      } else {
        aliasMap.set(alias, {
          engines: [{ ...engine, supportedModelFormats }],
          fields: new Set(fields),
        });
      }
    }
  }

  return aliasMap;
}

// Returns list of all matching engines
export function resolveAlias(
  engineInfos: RuntimeEngineInfo[],
  alias: string,
  modelFormats?: Set<string>,
): {
  engines: {
    name: string;
    version: string;
    selectForModelFormats: Set<string>;
  }[];
  fields: Set<AliasField>;
} {
  const map = generateAliasMap(engineInfos);
  const elem = map.get(alias);
  if (elem === undefined) {
    throw Error("Alias not found: " + alias);
  }

  const { engines: prelimEngines, fields } = elem;

  // Apply passed in model formats. An engine must be compatible with _all_ requested formats
  // to be a selection candidate. We track selectForModelFormats to ensure we only select
  // for requested formats
  if (modelFormats !== undefined) {
    const engines = prelimEngines
      .filter(e => {
        return [...modelFormats].every(format => e.supportedModelFormats.has(format));
      })
      .map(e => {
        return { name: e.name, version: e.version, selectForModelFormats: modelFormats };
      });
    if (engines.length === 0) {
      throw Error(
        "Alias '" +
          alias +
          "' does not match any engines that are compatible with model format(s) [" +
          [...modelFormats].join(",") +
          "].",
      );
    }
    return { engines, fields };
  } else {
    const engines = prelimEngines.map(e => {
      return { name: e.name, version: e.version, selectForModelFormats: e.supportedModelFormats };
    });
    return { engines, fields };
  }
}

// Returns single engine (must be unambiguous)
export function resolveUniqueAlias(
  engineInfos: RuntimeEngineInfo[],
  alias: string,
  modelFormats?: Set<string>,
): {
  engine: {
    name: string;
    version: string;
    selectForModelFormats: Set<string>;
  };
  fields: Set<AliasField>;
} {
  const { engines, fields } = resolveAlias(engineInfos, alias, modelFormats);

  if (engines.length === 1) {
    return { engine: engines[0], fields };
  } else {
    throw Error(
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
  engine: {
    name: string;
    version: string;
    selectForModelFormats: Set<string>;
  };
  fields: Set<AliasField>;
} {
  const { engines, fields } = resolveAlias(engineInfos, alias, modelFormats);

  const engineNames = new Set([...engines].map(e => e.name));
  if (engineNames.size > 1) {
    throw Error(
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
