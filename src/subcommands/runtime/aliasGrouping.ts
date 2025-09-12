import { RuntimeEngineInfo } from "../../../../lms-shared-types/dist/types/RuntimeEngine.js";
import {
  AliasField,
  AliasGenerator,
  ALL_ALIAS_FIELDS,
  BuiltAlias,
  fallbackAlias,
  LlamaCppAliasGenerator,
  MlxAliasGenerator,
} from "./aliasGeneration.js";

/**
 * Groups engines by type and manages minimum component analysis for display purposes.
 */
export class AliasGroup {
  public readonly minimumComponents: Set<AliasField>;

  constructor(
    public readonly engineType: string,
    public readonly engines: RuntimeEngineInfo[],
    public readonly generator: AliasGenerator,
  ) {
    this.minimumComponents = this.computeMinimumComponents();
  }

  private computeMinimumComponents(): Set<AliasField> {
    const nonUniform = getNonUniformFields(this.engines);
    // Always include a VERSION in the displayed name
    nonUniform.add("version");
    return nonUniform;
  }

  generateAliasesForEngine(engine: RuntimeEngineInfo): BuiltAlias[] {
    return this.generator.generateAllAliases(engine);
  }

  selectMinimalAlias(aliases: BuiltAlias[]): BuiltAlias | null {
    return selectMinimalAlias(aliases, this.minimumComponents) ?? null;
  }

  resolve(targetAlias: string): Array<{
    engine: RuntimeEngineInfo;
    matchedAlias: BuiltAlias;
  }> {
    const matches: Array<{ engine: RuntimeEngineInfo; matchedAlias: BuiltAlias }> = [];

    for (const engine of this.engines) {
      const aliases = this.generateAliasesForEngine(engine);
      // Include fallback alias for CLI compatibility
      aliases.push(fallbackAlias(engine));

      for (const alias of aliases) {
        if (alias.alias === targetAlias) {
          matches.push({ engine, matchedAlias: alias });
        }
      }
    }

    return matches;
  }

  static createGroups(engines: RuntimeEngineInfo[]): AliasGroup[] {
    const enginesByType = groupBy(engines, e => e.engine);

    return Array.from(enginesByType.entries()).map(([engineType, typeEngines]) => {
      const generator = AliasGroup.createGenerator(engineType);
      return new AliasGroup(engineType, typeEngines, generator);
    });
  }

  private static createGenerator(engineType: string): AliasGenerator {
    switch (engineType) {
      case "llama.cpp":
        return new LlamaCppAliasGenerator();
      case "mlx-llm":
        return new MlxAliasGenerator();
      default:
        return new AliasGenerator();
    }
  }
}

// Utility Functions

/**
 * Groups array elements by a key function.
 */
function groupBy<T, K>(array: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of array) {
    const key = keyFn(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Identifies which display name fields have varying values across engine manifests.
 * @param manifests - Array of engine manifests to analyze
 * @returns Set of fields that vary across the manifests
 */
function getNonUniformFields(manifests: RuntimeEngineInfo[]): Set<AliasField> {
  if (manifests.length === 0) return new Set();

  const hasVariation = (values: (string | string[] | undefined)[]): boolean => {
    const normalized = values.map(v =>
      (Array.isArray(v) ? [...v].sort().join(",") : v ?? "").toLowerCase(),
    );
    return new Set(normalized).size > 1;
  };

  const fieldExtractors: Record<
    AliasField,
    (m: RuntimeEngineInfo) => string | string[] | undefined
  > = {
    engine: m => m.engine,
    platform: m => m.platform,
    gpuFramework: m => m.gpu?.framework,
    cpuArchitecture: m => m.cpu.architecture,
    cpuInstructionSetExtensions: m => m.cpu.instructionSetExtensions ?? [],
    version: m => m.version,
  };

  return new Set(
    ALL_ALIAS_FIELDS.filter(field => hasVariation(manifests.map(m => fieldExtractors[field](m)))),
  );
}

/**
 * Selects the alias with the fewest components that includes all required fields.
 * @param aliases - Array of available aliases
 * @param minimumFields - Required fields that must be present in the selected alias
 * @returns The minimal alias that satisfies requirements, or undefined if none found
 */
function selectMinimalAlias(
  aliases: BuiltAlias[],
  minimumFields: Set<AliasField>,
): BuiltAlias | undefined {
  const sortedAliases = [...aliases];
  sortedAliases.sort((a, b) => a.fields.size - b.fields.size);

  const minimalAlias = sortedAliases.find(alias => {
    for (const field of minimumFields) {
      if (!alias.fields.has(field)) {
        return false;
      }
    }
    return true;
  });

  return minimalAlias;
}
