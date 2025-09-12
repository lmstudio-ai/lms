import { RuntimeEngineInfo } from "../../../../../lms-shared-types/dist/types/RuntimeEngine.js";
import {
  AliasField,
  AliasGenerator,
  ALL_ALIAS_FIELDS,
  BuiltAlias,
  generateFullAlias,
  LlamaCppAliasGenerator,
  MlxAliasGenerator,
} from "./AliasGenerator.js";

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
    if (this.engines.length === 0) return new Set(["version"]);

    const fieldExtractors: Record<
      AliasField,
      (e: RuntimeEngineInfo) => string | string[] | undefined
    > = {
      engine: e => e.engine,
      platform: e => e.platform,
      gpuFramework: e => e.gpu?.framework,
      cpuArchitecture: e => e.cpu.architecture,
      cpuInstructionSetExtensions: e => e.cpu.instructionSetExtensions ?? [],
      version: e => e.version,
    };

    const nonUniform = new Set(
      ALL_ALIAS_FIELDS.filter(field =>
        hasVariation(this.engines.map(e => fieldExtractors[field](e))),
      ),
    );

    // Always include a VERSION in the displayed name
    nonUniform.add("version");
    return nonUniform;
  }

  generateAliasesForEngine(engine: RuntimeEngineInfo): BuiltAlias[] {
    return this.generator.generateAllAliases(engine);
  }

  selectMinimalAlias(aliases: BuiltAlias[]): BuiltAlias | null {
    const sortedAliases = [...aliases];
    sortedAliases.sort((a, b) => a.fields.size - b.fields.size);

    const minimalAlias = sortedAliases.find(alias => {
      for (const field of this.minimumComponents) {
        if (!alias.fields.has(field)) {
          return false;
        }
      }
      return true;
    });

    return minimalAlias ?? null;
  }

  resolve(targetAlias: string): Array<{
    engine: RuntimeEngineInfo;
    matchedAlias: BuiltAlias;
  }> {
    const matches: Array<{ engine: RuntimeEngineInfo; matchedAlias: BuiltAlias }> = [];

    for (const engine of this.engines) {
      const aliases = this.generateAliasesForEngine(engine);
      // Include full alias compatibility with --full output
      aliases.push(generateFullAlias(engine));

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
 * Checks if a collection of values has variation (different values).
 */
function hasVariation(values: (string | string[] | undefined)[]): boolean {
  const normalized = values.map(v =>
    (Array.isArray(v) ? [...v].sort().join(",") : v ?? "").toLowerCase(),
  );
  return new Set(normalized).size > 1;
}
