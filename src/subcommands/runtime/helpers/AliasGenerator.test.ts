import { RuntimeEngineInfo } from "@lmstudio/lms-shared-types";
import { AliasField, AliasGenerator } from "./AliasGenerator.js";

// llama.cpp engine (Windows x86_64 with NVIDIA CUDA)
const llamaCppWindowsCudaRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "llama.cpp-win-x86_64-nvidia-cuda-avx2",
  version: "1.50.2",
  engine: "llama.cpp",
  platform: "win",
  cpu: {
    architecture: "x86_64",
    instructionSetExtensions: ["AVX2"],
  },
  gpu: {
    make: "Nvidia",
    framework: "CUDA",
  },
  supportedModelFormatNames: ["GGUF"],
};

// Test engine with missing instruction set extensions (for edge case testing)
const engineMissingInstructionsRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "test-engine-no-cpu-instruction-set-extensions",
  version: "1.0.0",
  engine: "test-engine",
  platform: "linux",
  cpu: {
    architecture: "x86_64",
    instructionSetExtensions: [],
  },
  supportedModelFormatNames: ["GGUF"],
};

// Test engine with multiple instruction set extensions (for edge case testing)
const engineMultipleInstructionsRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "test-engine-multiple-cpu-instruction-set-extensions",
  version: "1.0.0",
  engine: "test-engine",
  platform: "linux",
  cpu: {
    architecture: "x86_64",
    instructionSetExtensions: ["foo", "bar"],
  },
  supportedModelFormatNames: ["GGUF"],
};

// Test engine with no GPU (for CPU fallback testing)
const engineNoGpuRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "cpu-only-engine",
  version: "2.1.0",
  engine: "cpu-engine",
  platform: "macos",
  cpu: {
    architecture: "arm64",
    instructionSetExtensions: ["NEON"],
  },
  supportedModelFormatNames: ["GGUF"],
};

// Test engine with undefined instruction set extensions (for edge case testing)
const engineUndefinedInstructionsRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "test-engine-undefined-cpu-instruction-set-extensions",
  version: "1.0.0",
  engine: "test-engine",
  platform: "linux",
  cpu: {
    architecture: "x86_64",
    // instructionSetExtensions is intentionally omitted to be undefined
  },
  supportedModelFormatNames: ["GGUF"],
};

interface GenerateAliasTestCase {
  description: string;
  engine: RuntimeEngineInfo;
  fields: AliasField[];
  expectedResult: string | null;
}

describe("AliasGenerator", () => {
  describe("generateAlias", () => {
    const generator = new AliasGenerator();

    // Individual Branch Tests
    describe("individual field tests", () => {
      const individualFieldTests: GenerateAliasTestCase[] = [
        {
          description: "engine field only",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["engine"],
          expectedResult: "llama.cpp",
        },
        {
          description: "platform field only",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["platform"],
          expectedResult: "win",
        },
        {
          description: "cpuArchitecture field only",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["cpuArchitecture"],
          expectedResult: "x86_64",
        },
        {
          description: "gpuFramework field only (with GPU)",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["gpuFramework"],
          expectedResult: "cuda",
        },
        {
          description: "gpuFramework field only (no GPU - fallback to cpu)",
          engine: engineNoGpuRuntimeEngineInfo,
          fields: ["gpuFramework"],
          expectedResult: "cpu",
        },
        {
          description: "cpuInstructionSetExtensions field only (single extension)",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["cpuInstructionSetExtensions"],
          expectedResult: "avx2",
        },
        {
          description: "cpuInstructionSetExtensions field only (multiple extensions)",
          engine: engineMultipleInstructionsRuntimeEngineInfo,
          fields: ["cpuInstructionSetExtensions"],
          expectedResult: "foo_bar",
        },
        {
          description: "version field only",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["version"],
          expectedResult: "@1.50.2",
        },
      ];

      describe.each(individualFieldTests)("$description", ({ engine, fields, expectedResult }) => {
        it(`should generate correct alias`, () => {
          const result = generator.generateAlias(engine, new Set(fields));
          expect(result).not.toBeNull();
          expect(result!.alias).toBe(expectedResult);
          expect(result!.fields).toEqual(new Set(fields));
        });
      });
    });

    // Error Cases
    describe("error cases", () => {
      const errorCaseTests: GenerateAliasTestCase[] = [
        {
          description: "missing CPU instructions (empty array)",
          engine: engineMissingInstructionsRuntimeEngineInfo,
          fields: ["cpuInstructionSetExtensions"],
          expectedResult: null,
        },
        {
          description: "missing CPU instructions (undefined)",
          engine: engineUndefinedInstructionsRuntimeEngineInfo,
          fields: ["cpuInstructionSetExtensions"],
          expectedResult: null,
        },
      ];

      describe.each(errorCaseTests)("$description", ({ engine, fields, expectedResult }) => {
        it("should return null when required component is missing", () => {
          const result = generator.generateAlias(engine, new Set(fields));
          expect(result).toBeNull();
        });
      });
    });

    // Combination Tests
    describe("combination tests", () => {
      const combinationTests: GenerateAliasTestCase[] = [
        {
          description: "engine + platform",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["engine", "platform"],
          expectedResult: "llama.cpp-win",
        },
        {
          description: "engine + gpuFramework",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["engine", "gpuFramework"],
          expectedResult: "llama.cpp-cuda",
        },
        {
          description: "engine + version",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["engine", "version"],
          expectedResult: "llama.cpp@1.50.2",
        },
        {
          description: "engine + platform + cpuArchitecture + gpuFramework",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: ["engine", "platform", "cpuArchitecture", "gpuFramework"],
          expectedResult: "llama.cpp-win-x86_64-cuda",
        },
        {
          description: "all fields (valid instructions)",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: [
            "engine",
            "platform",
            "cpuArchitecture",
            "gpuFramework",
            "cpuInstructionSetExtensions",
          ],
          expectedResult: "llama.cpp-win-x86_64-cuda-avx2",
        },
        {
          description: "all fields including version",
          engine: llamaCppWindowsCudaRuntimeEngineInfo,
          fields: [
            "engine",
            "platform",
            "cpuArchitecture",
            "gpuFramework",
            "cpuInstructionSetExtensions",
            "version",
          ],
          expectedResult: "llama.cpp-win-x86_64-cuda-avx2@1.50.2",
        },
      ];

      describe.each(combinationTests)("$description", ({ engine, fields, expectedResult }) => {
        it("should generate correct combined alias", () => {
          const result = generator.generateAlias(engine, new Set(fields));
          expect(result).not.toBeNull();
          expect(result!.alias).toBe(expectedResult);
          expect(result!.fields).toEqual(new Set(fields));
        });
      });
    });

    // Edge Cases
    describe("edge cases", () => {
      it("should handle empty fields set", () => {
        const result = generator.generateAlias(llamaCppWindowsCudaRuntimeEngineInfo, new Set([]));
        expect(result).not.toBeNull();
        expect(result!.alias).toBe("");
        expect(result!.fields).toEqual(new Set([]));
      });

      it("should handle custom delimiter configuration", () => {
        const customGenerator = new AliasGenerator({ delimiter: "_", versionDelimiter: "#" });
        const result = customGenerator.generateAlias(
          llamaCppWindowsCudaRuntimeEngineInfo,
          new Set(["engine", "platform", "version"]),
        );
        expect(result).not.toBeNull();
        expect(result!.alias).toBe("llama.cpp_win#1.50.2");
      });
    });
  });
});
