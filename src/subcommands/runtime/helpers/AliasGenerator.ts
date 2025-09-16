import { RuntimeEngineInfo, RuntimeEngineSpecifier } from "@lmstudio/lms-shared-types";

export const ALL_ALIAS_FIELDS = [
  "engine",
  "platform",
  "gpuFramework",
  "cpuArchitecture",
  "cpuInstructionSetExtensions",
  "version",
] as const;

export type AliasField = (typeof ALL_ALIAS_FIELDS)[number];

export interface BuiltAlias {
  fields: Set<AliasField>;
  alias: string;
}

export interface AliasConfig {
  delimiter: string;
  versionDelimiter: string;
}

/**
 * Error thrown when a requested display name field cannot be satisfied due to missing data.
 */
export class MissingAliasComponentError extends Error {
  public readonly field: AliasField;

  constructor(field: AliasField, message: string) {
    super(`Missing ${field} in engine manifest: ${message}`);
    this.name = "MissingAliasComponentError";
    this.field = field;
  }
}

/**
 * Generates a full alias using the engine name and version.
 * Assumed to be a unique identifier.
 * @param engine - The runtime engine specifier
 * @returns A full alias
 */
export function generateFullAlias(engine: RuntimeEngineSpecifier): BuiltAlias {
  // Note: this uses "-" instead of "@" before the version to ensure differentiation
  // from the shorter aliases.
  return {
    alias: engine.name + "-" + engine.version,
    fields: new Set(["version"]),
  };
}

/**
 * Base alias generator with standard implementation that can be extended by engine-specific generators.
 */
export class AliasGenerator {
  constructor(protected config: AliasConfig = { delimiter: "-", versionDelimiter: "@" }) {}

  /**
   * Returns the base component sets for alias generation (without versioned variants)
   * @returns Array of field sets
   */
  protected getBaseAliasComponentSets(): Set<AliasField>[] {
    // Each set defines the fields that will be be used to generate one alias for an Engine.
    // These specific alias field sets were chosen to show just engine and gpuFramework to most
    // users (unless they have incompatible runtimes installed on their system).
    return [
      new Set<AliasField>(["engine"]),
      new Set<AliasField>(["engine", "gpuFramework"]),
      new Set<AliasField>(["engine", "gpuFramework", "platform"]),
      new Set<AliasField>(["engine", "gpuFramework", "platform", "cpuArchitecture"]),
      new Set<AliasField>([
        "engine",
        "gpuFramework",
        "platform",
        "cpuArchitecture",
        "cpuInstructionSetExtensions",
      ]),
    ];
  }

  /**
   * Returns all component sets for alias generation including versioned variants
   * @returns Array of field sets with both versioned and unversioned variants
   */
  protected getAliasComponentSets(): Set<AliasField>[] {
    const baseSets = this.getBaseAliasComponentSets();
    const allSets: Set<AliasField>[] = [];

    baseSets.forEach(baseSet => {
      allSets.push(baseSet);
      // Add versioned variant (if not already versioned)
      if (!baseSet.has("version")) {
        const versionedSet = new Set(baseSet);
        versionedSet.add("version");
        allSets.push(versionedSet);
      }
    });

    return allSets;
  }

  /**
   * Generates a single alias for the given engine and fields.
   * @param engine - The runtime engine info to generate the alias for
   * @param fields - The set of fields to include in the alias
   * @returns The built alias or null if missing required components
   */
  generateAlias(engine: RuntimeEngineInfo, fields: Set<AliasField>): BuiltAlias | null {
    try {
      return {
        fields,
        alias: this.buildAliasString(engine, fields),
      };
    } catch (error) {
      if (error instanceof MissingAliasComponentError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Builds the alias string from engine info and fields.
   * @param engine - The runtime engine info
   * @param fields - The set of fields to include in the alias string
   * @returns The constructed alias string in lowercase
   */
  protected buildAliasString(engine: RuntimeEngineInfo, fields: Set<AliasField>): string {
    const aliasParts: string[] = [];

    if (fields.has("engine")) {
      aliasParts.push(this.mapEngineName(engine.engine));
    }
    if (fields.has("platform")) {
      aliasParts.push(engine.platform);
    }
    if (fields.has("cpuArchitecture")) {
      aliasParts.push(engine.cpu.architecture);
    }
    if (fields.has("gpuFramework")) {
      aliasParts.push(engine.gpu?.framework || "cpu");
    }
    if (fields.has("cpuInstructionSetExtensions")) {
      if (
        engine.cpu.instructionSetExtensions !== undefined &&
        engine.cpu.instructionSetExtensions.length > 0
      ) {
        aliasParts.push(engine.cpu.instructionSetExtensions.join("_"));
      } else {
        throw new MissingAliasComponentError(
          "cpuInstructionSetExtensions",
          "CPU instruction set extensions are empty or undefined",
        );
      }
    }

    const versionedParts = [aliasParts.join(this.config.delimiter)];
    if (fields.has("version")) {
      versionedParts.push(engine.version);
    }

    return versionedParts.join(this.config.versionDelimiter).toLowerCase();
  }

  /**
   * Maps engine names for display purposes.
   * @param engineName - The original engine name
   * @returns The mapped engine name for display
   */
  protected mapEngineName(engineName: string): string {
    return engineName;
  }

  /**
   * Generates all aliases for an engine with increasing specificity.
   * @param engine - The runtime engine info
   * @returns Array of built aliases with versioned and unversioned variants
   */
  generateAllAliases(engine: RuntimeEngineInfo): BuiltAlias[] {
    const componentSets = this.getAliasComponentSets();
    return componentSets
      .map(components => this.generateAlias(engine, components))
      .filter((alias): alias is BuiltAlias => alias !== null);
  }
}
