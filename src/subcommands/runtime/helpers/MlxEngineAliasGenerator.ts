import { AliasGenerator } from "./AliasGenerator.js";

/**
 * MLX specific generator that maps mlx-llm to mlx-engine.
 */
export class MlxEngineAliasGenerator extends AliasGenerator {
  /**
   * Maps MLX engine names for display purposes.
   * @param engineName - The original engine name
   * @returns The mapped engine name
   */
  protected override mapEngineName(engineName: string): string {
    // Rename mlx-llm -> mlx-engine for improved comprehension
    if (engineName !== "mlx-llm") {
      throw new Error(`Unexpected engine name: ${engineName}`);
    }
    return "mlx-engine";
  }
}
