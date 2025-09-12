import { RuntimeEngineSelectionInfo } from "@lmstudio/sdk";
import {
  RuntimeEngineInfo,
  RuntimeEngineSpecifier,
} from "../../../../lms-shared-types/dist/types/RuntimeEngine.js";

// =================================================================================================
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
 * Generates a display alias for a runtime engine based on specified fields.
 * @param manifest - The engine manifest containing engine information
 * @param fields - Set of fields to include in the alias
 * @returns A formatted alias string
 */
export function generateAlias(
  manifest: RuntimeEngineInfo,
  fields: Set<AliasField>,
  delimiter: string = "-",
  versionDelimiter: string = "@",
): string {
  const aliasParts: string[] = [];

  if (fields.has("engine")) {
    // Business decision to map mlx-llm -> mlx-engine
    if (manifest.engine === "mlx-llm") {
      aliasParts.push("mlx-engine");
    } else {
      aliasParts.push(manifest.engine);
    }
  }
  if (fields.has("platform")) {
    aliasParts.push(manifest.platform);
  }
  if (fields.has("cpuArchitecture")) {
    aliasParts.push(manifest.cpu.architecture);
  }
  if (fields.has("gpuFramework")) {
    // If a framework does not specify a GPU, use "cpu" instead
    aliasParts.push(manifest.gpu?.framework || "cpu");
  }
  if (fields.has("cpuInstructionSetExtensions")) {
    if (manifest.cpu.instructionSetExtensions?.length) {
      // Use _ to match the manifest_builder.py logic
      aliasParts.push(manifest.cpu.instructionSetExtensions.join("_"));
    } else {
      throw new MissingAliasComponentError(
        "cpuInstructionSetExtensions",
        "CPU instruction set extensions are empty or undefined",
      );
    }
  }

  const versionedParts = [aliasParts.join(delimiter)];
  if (fields.has("version")) {
    versionedParts.push(manifest.version);
  }

  return versionedParts.join(versionDelimiter).toLowerCase();
}

/**
 * Identifies which display name fields have varying values across engine manifests.
 * @param manifests - Array of engine manifests to analyze
 * @returns Set of fields that vary across the manifests
 */
export function getNonUniformFields(manifests: RuntimeEngineInfo[]): Set<AliasField> {
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
 * Safely generates an alias, returning null if the components cannot be satisfied
 * @param manifest - The engine manifest containing engine information
 * @param components - Set of fields to include in the alias
 * @returns A built alias or null if the components cannot be satisfied
 */
function tryGenerateAlias(manifest: RuntimeEngineInfo, fields: Set<AliasField>): BuiltAlias | null {
  try {
    return {
      fields,
      alias: generateAlias(manifest, fields),
    };
  } catch (error) {
    if (error instanceof MissingAliasComponentError) {
      return null; // Signal that this alias cannot be generated
    }
    throw error; // Re-throw unexpected errors
  }
}

/**
 * Generates all aliases for an engine manifest with increasing specificity.
 * Creates both versioned and unversioned variants at each specificity level.
 * @param manifest - The engine manifest to generate aliases for
 * @returns Array of built aliases with their component sets
 */
export function generateAliases(manifest: RuntimeEngineInfo): BuiltAlias[] {
  // The set components at each index does not need to be a superset of the previous.
  // A versioned alias will also be added for each
  const aliasComponents: Set<AliasField>[] = [];
  if (manifest.engine !== "llama.cpp") {
    // Business decision to force llama.cpp engines to include the GPU framework.
    aliasComponents.push(new Set<AliasField>(["engine"]));
  }
  aliasComponents.push(new Set<AliasField>(["engine", "gpuFramework"]));
  aliasComponents.push(new Set<AliasField>(["engine", "gpuFramework", "platform"]));
  aliasComponents.push(
    new Set<AliasField>(["engine", "gpuFramework", "platform", "cpuArchitecture"]),
  );
  aliasComponents.push(
    new Set<AliasField>([
      "engine",
      "gpuFramework",
      "platform",
      "cpuArchitecture",
      "cpuInstructionSetExtensions",
    ]),
  );

  const aliases = aliasComponents.flatMap(components => {
    const builtAliases: BuiltAlias[] = [];

    const baseAlias = tryGenerateAlias(manifest, components);
    if (baseAlias) {
      builtAliases.push(baseAlias);
    }

    if (baseAlias && !components.has("version")) {
      const componentsWithVersion = new Set(components);
      componentsWithVersion.add("version");
      const versionedAlias = tryGenerateAlias(manifest, componentsWithVersion);
      if (versionedAlias) {
        builtAliases.push(versionedAlias);
      }
    }

    return builtAliases;
  });

  return aliases;
}

/**
 * Selects the alias with the fewest components that includes all required fields.
 * @param aliases - Array of available aliases
 * @param minimumFields - Required fields that must be present in the selected alias
 * @returns The minimal alias that satisfies requirements, or undefined if none found
 */
export function selectMinimalAlias(
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
 * Resolves display alias conflicts by falling back to full aliases when duplicates exist.
 * @param capabilities - Array of runtime engine capabilities to process
 */
function resolveDuplicateMinimalAliases(capabilities: RuntimeEngineDisplayInfo[]): void {
  const aliasCounts = new Map<string, number>();
  for (const displayInfo of capabilities) {
    const current = aliasCounts.get(displayInfo.minimalAlias) || 0;
    aliasCounts.set(displayInfo.minimalAlias, current + 1);
  }

  // Replace duplicates with fallback aliases
  for (const displayInfo of capabilities) {
    const occurrences = aliasCounts.get(displayInfo.minimalAlias) || 0;
    if (occurrences <= 0) {
      throw new Error(
        `Expected alias '${displayInfo.minimalAlias}' to occur at least once, but found ${occurrences} occurrences.`,
      );
    } else if (occurrences >= 2) {
      const fallback = fallbackAlias(displayInfo.specifier).alias;
      console.warn(
        "Found " +
          occurrences +
          " display aliases set to " +
          displayInfo.minimalAlias +
          ". Falling back to " +
          fallback,
      );
      displayInfo.minimalAlias = fallback;
    }
  }
}

// =================================================================================================

export interface RuntimeEngineDisplayInfo {
  specifier: RuntimeEngineSpecifier;
  minimalAlias: string;
  fullAlias: string;
  supportedModelFormats: string[];
  selectedModelFormats: string[];
}

export function constructDisplayInfo(
  engines: RuntimeEngineInfo[],
  selections: RuntimeEngineSelectionInfo[],
): RuntimeEngineDisplayInfo[] {
  const enginesTypes = new Set<string>(engines.map(e => e.engine));
  // Gather the minimum unambiguous components per engine type so that each varies independently.
  // I.e. we may need extended specification for llama.cpp, but not mlx-engine.
  const enginesTypeToMinComponents = [...enginesTypes].map(engineType => {
    const minComponents = getNonUniformFields(engines.filter(e => e.engine === engineType));
    // Always include a VERSION in the displayed name
    minComponents.add("version");
    return {
      engineType,
      minComponents,
    };
  });

  const enginesAndAliases = engines.map(engine => {
    return {
      engine,
      builtAliases: generateAliases(engine),
    };
  });

  const engineDisplayInfo: RuntimeEngineDisplayInfo[] = enginesAndAliases.map(engineAndAliases => {
    const engineTypeConfig = enginesTypeToMinComponents.find(
      ({ engineType }) => engineType === engineAndAliases.engine.engine,
    );

    if (!engineTypeConfig) {
      throw new Error(
        `Engine type '${engineAndAliases.engine.engine}' not found in engine type configurations. Available types: [${[...enginesTypes].join(", ")}]`,
      );
    }

    const fullAlias = fallbackAlias(engineAndAliases.engine).alias;
    return {
      specifier: engineAndAliases.engine,
      minimalAlias:
        selectMinimalAlias(engineAndAliases.builtAliases, engineTypeConfig.minComponents)?.alias ??
        fullAlias,
      fullAlias,
      supportedModelFormats: engineAndAliases.engine.supportedModelFormats,
      selectedModelFormats: selections
        .filter(
          selection =>
            selection.name === engineAndAliases.engine.name &&
            selection.version === engineAndAliases.engine.version,
        )
        .flatMap(selection => selection.modelFormats),
    };
  });
  return engineDisplayInfo;
}
