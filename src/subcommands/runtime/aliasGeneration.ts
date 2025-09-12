import {
  RuntimeEngineInfo,
  RuntimeEngineSpecifier,
} from "../../../../lms-shared-types/dist/types/RuntimeEngine.js";

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
 * Generates a fallback alias using the engine name and version.
 * Assumed to be a unique identifier that matches the directory name on disk.
 * @param engine - The runtime engine specifier
 * @returns A fallback alias
 */
export function fallbackAlias(engine: RuntimeEngineSpecifier): BuiltAlias {
  // Note: this uses "-" instead of "@" before the version to ensure differentiation
  // from the generated aliases.
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
   * Returns the standard component sets for alias generation.
   * Can be overridden by subclasses for engine-specific requirements.
   */
  getAliasComponentSets(engine: RuntimeEngineInfo): Set<AliasField>[] {
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
   * Generates a single alias for the given engine and fields.
   * Can be overridden for engine-specific logic.
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
   * Can be overridden for custom alias construction.
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
      if (engine.cpu.instructionSetExtensions?.length) {
        // Use _ to match the manifest_builder.py logic
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
   * Can be overridden for engine-specific name mappings.
   */
  protected mapEngineName(engineName: string): string {
    return engineName;
  }

  /**
   * Generates all aliases for an engine with increasing specificity.
   * Creates both versioned and unversioned variants at each specificity level.
   */
  generateAllAliases(engine: RuntimeEngineInfo): BuiltAlias[] {
    const componentSets = this.getAliasComponentSets(engine);
    return componentSets.flatMap(components => {
      const aliases: BuiltAlias[] = [];

      const baseAlias = this.generateAlias(engine, components);
      if (baseAlias) {
        aliases.push(baseAlias);
      }

      if (baseAlias && !components.has("version")) {
        const versionedComponents = new Set(components);
        versionedComponents.add("version");
        const versionedAlias = this.generateAlias(engine, versionedComponents);
        if (versionedAlias) {
          aliases.push(versionedAlias);
        }
      }

      return aliases;
    });
  }
}

/**
 * Llama.cpp specific generator that requires GPU framework to be included.
 */
export class LlamaCppAliasGenerator extends AliasGenerator {
  override getAliasComponentSets(engine: RuntimeEngineInfo): Set<AliasField>[] {
    // Force llama.cpp engines to include the GPU framework for improved comprehension
    return [
      new Set<AliasField>(["engine", "gpuFramework"]), // No engine-only alias
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
}

/**
 * MLX specific generator that maps mlx-llm to mlx-engine.
 */
export class MlxAliasGenerator extends AliasGenerator {
  protected override mapEngineName(engineName: string): string {
    // Rename mlx-llm -> mlx-engine for improved comprehension
    return engineName === "mlx-llm" ? "mlx-engine" : engineName;
  }
}
