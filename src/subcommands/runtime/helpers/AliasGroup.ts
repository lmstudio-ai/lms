import { RuntimeEngineInfo } from "@lmstudio/lms-shared-types";
import {
  AliasField,
  AliasGenerator,
  ALL_ALIAS_FIELDS,
  BuiltAlias,
  generateFullAlias,
} from "./AliasGenerator.js";
import { AliasGeneratorFactory } from "./AliasGeneratorFactory.js";

/**
 * Groups engines by type and manages minimum component analysis for display purposes.
 */
export class AliasGroup {
  private readonly minimumComponents: Set<AliasField>;

  constructor(
    private readonly engineType: string,
    private readonly engines: RuntimeEngineInfo[],
    private readonly generator: AliasGenerator,
  ) {
    this.minimumComponents = this.computeMinimumComponents();
  }

  /**
   * Computes the minimum set of alias fields required to uniquely identify engines in this group.
   * @returns Set of alias fields that vary across engines in the group
   */
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

  /**
   * Generates all possible aliases for the specified runtime engine.
   * @param engine - The runtime engine to generate aliases for
   * @returns Array of built aliases for the engine
   */
  private generateAliasesForEngine(engine: RuntimeEngineInfo): BuiltAlias[] {
    return this.generator.generateAllAliases(engine);
  }

  /**
   * Selects the shortest alias that contains all required minimum components.
   * @param aliases - Array of available aliases to choose from
   * @returns The minimal alias or null if none contains all required components
   */
  private selectMinimalAlias(aliases: BuiltAlias[]): BuiltAlias | null {
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

  /**
   * Finds all engines in this group that match the specified target alias.
   * @param targetAlias - The alias string to search for
   * @returns Array of engines with their matching aliases
   */
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

  /**
   * Gets all engines in this group with their minimal aliases.
   * @returns Array of engines paired with their minimal alias strings
   */
  getEnginesWithMinimalAliases(): Array<{
    engine: RuntimeEngineInfo;
    minimalAlias: string;
    fullAlias: string;
  }> {
    return this.engines.map(engine => {
      const aliases = this.generateAliasesForEngine(engine);
      const minimalAlias = this.selectMinimalAlias(aliases);
      const fullAlias = generateFullAlias(engine).alias;

      return {
        engine,
        minimalAlias: minimalAlias?.alias ?? fullAlias,
        fullAlias,
      };
    });
  }

  /**
   * Creates alias groups organized by engine type from the provided engines.
   * @param engines - Array of runtime engines to group
   * @returns Array of alias groups organized by engine type
   */
  static createGroups(engines: RuntimeEngineInfo[]): AliasGroup[] {
    const enginesByType = groupBy(engines, e => e.engine);

    return Array.from(enginesByType.entries()).map(([engineType, typeEngines]) => {
      const generator = AliasGeneratorFactory.createGenerator(engineType);
      return new AliasGroup(engineType, typeEngines, generator);
    });
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
