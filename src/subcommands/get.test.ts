import { formatCompatibilityTypeSuffix } from "./get.js";

jest.mock("@inquirer/prompts", () => ({ search: jest.fn(), select: jest.fn() }));

describe("formatCompatibilityTypeSuffix", () => {
  it.each([
    ["gguf", "[GGUF]"],
    ["safetensors", "[MLX]"],
    ["torch_safetensors", "[PT]"],
    ["onnx", ""],
  ] as const)("labels %s as %s", (compatibilityType, expected) => {
    expect(formatCompatibilityTypeSuffix(compatibilityType)).toBe(expected);
  });
});
