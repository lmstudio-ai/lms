import { RuntimeEngineInfo } from "@lmstudio/sdk";
import { AliasField } from "./AliasGenerator.js";
import { MlxEngineAliasGenerator } from "./MlxEngineAliasGenerator.js";

const mlxRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "mlx-llm-mac-arm64-apple-metal-advsimd",
  version: "0.26.1",
  engine: "mlx-llm",
  platform: "mac",
  cpu: {
    architecture: "ARM64",
    instructionSetExtensions: ["AdvSIMD"],
  },
  gpu: {
    make: "Apple",
    framework: "Metal",
  },
  supportedModelFormatNames: ["MLX"],
};

// Test engine with different engine name for error testing
const invalidEngineRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "different-engine-test",
  version: "1.0.0",
  engine: "different-engine",
  platform: "linux",
  cpu: {
    architecture: "x86_64",
    instructionSetExtensions: ["AVX2"],
  },
  supportedModelFormatNames: ["GGUF"],
};

interface MlxGenerateAliasTestCase {
  description: string;
  engine: RuntimeEngineInfo;
  fields: AliasField[];
  expectedResult: string;
}

describe("MlxEngineAliasGenerator", () => {
  const generator = new MlxEngineAliasGenerator();

  describe("generateAlias", () => {
    const successTestCases: MlxGenerateAliasTestCase[] = [
      {
        description: "engine field only - should map mlx-llm to mlx-engine",
        engine: mlxRuntimeEngineInfo,
        fields: ["engine"],
        expectedResult: "mlx-engine",
      },
      {
        description: "engine + platform - should use mapped engine name",
        engine: mlxRuntimeEngineInfo,
        fields: ["engine", "platform"],
        expectedResult: "mlx-engine-mac",
      },
      {
        description: "engine + platform + gpuFramework - should use mapped engine name",
        engine: mlxRuntimeEngineInfo,
        fields: ["engine", "platform", "gpuFramework"],
        expectedResult: "mlx-engine-mac-metal",
      },
      {
        description: "engine + version - should use mapped engine name with version",
        engine: mlxRuntimeEngineInfo,
        fields: ["engine", "version"],
        expectedResult: "mlx-engine@0.26.1",
      },
      {
        description: "all fields - should use mapped engine name in complex alias",
        engine: mlxRuntimeEngineInfo,
        fields: [
          "engine",
          "platform",
          "cpuArchitecture",
          "gpuFramework",
          "cpuInstructionSetExtensions",
        ],
        expectedResult: "mlx-engine-mac-arm64-metal-advsimd",
      },
    ];

    describe.each(successTestCases)("$description", ({ engine, fields, expectedResult }) => {
      it("should generate correct alias with engine name mapping", () => {
        const result = generator.generateAlias(engine, new Set(fields));
        expect(result).not.toBeNull();
        expect(result!.alias).toBe(expectedResult);
        expect(result!.fields).toEqual(new Set(fields));
      });
    });

    it("should throw error when trying to generate alias for unsupported engine", () => {
      expect(() => {
        generator.generateAlias(invalidEngineRuntimeEngineInfo, new Set(["engine"]));
      }).toThrow("Unexpected engine name: different-engine");
    });
  });
});
