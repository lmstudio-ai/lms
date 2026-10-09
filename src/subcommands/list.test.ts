import { type ModelInfo } from "@lmstudio/sdk";
import { calculateTotalSizeBytes } from "./list.js";

describe("calculateTotalSizeBytes", () => {
  const baseModel = { modelKey: "google/gemma-4-26b-a4b", sizeBytes: 30 } as ModelInfo;
  const otherModel = { modelKey: "nomic/embed", sizeBytes: 8 } as ModelInfo;

  it("sums every downloaded variant instead of the base model size", () => {
    const variants = [
      { modelKey: "google/gemma-4-26b-a4b@4bit", sizeBytes: 12 },
      { modelKey: "google/gemma-4-26b-a4b@q4_k_m", sizeBytes: 18 },
    ] as Array<ModelInfo>;

    expect(
      calculateTotalSizeBytes([baseModel, otherModel], new Map([[baseModel.modelKey, variants]])),
    ).toBe(38);
  });

  it("uses the base model size when variant details are unavailable", () => {
    expect(calculateTotalSizeBytes([baseModel, otherModel])).toBe(38);
    expect(calculateTotalSizeBytes([baseModel], new Map())).toBe(30);
  });
});
