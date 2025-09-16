import { AliasGenerator } from "./AliasGenerator.js";
import { LlamaCppAliasGenerator } from "./LlamaCppAliasGenerator.js";
import { MlxEngineAliasGenerator } from "./MlxEngineAliasGenerator.js";

/**
 * Factory for creating appropriate alias generators based on engine type
 */
export class AliasGeneratorFactory {
  /**
   * Creates the appropriate alias generator for the specified engine type.
   * @param engineType - The engine type to create a generator for
   * @returns Specialized alias generator for the engine type
   */
  static createGenerator(engineType: string): AliasGenerator {
    switch (engineType) {
      case "llama.cpp":
        return new LlamaCppAliasGenerator();
      case "mlx-llm":
        return new MlxEngineAliasGenerator();
      default:
        return new AliasGenerator();
    }
  }
}
