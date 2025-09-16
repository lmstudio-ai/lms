import { AliasField, AliasGenerator } from "./AliasGenerator.js";

/**
 * Llama.cpp specific generator that requires GPU framework to be included.
 */
export class LlamaCppAliasGenerator extends AliasGenerator {
  /**
   * Returns base component sets for Llama.cpp engines
   * @returns Array of field sets
   */
  protected override getBaseAliasComponentSets(): Set<AliasField>[] {
    // Force llama.cpp engines to include the GPU framework, for "cpu" if no GPU,
    // for improved comprehension
    return [
      // No engine-only alias
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
}
