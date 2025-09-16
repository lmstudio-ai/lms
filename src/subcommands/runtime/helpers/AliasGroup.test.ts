import { RuntimeEngineInfo } from "@lmstudio/lms-shared-types";
import { AliasGroup } from "./AliasGroup.js";

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

// llama.cpp engine (Mac ARM64 with Apple Metal)
const llamaCppMacRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "llama.cpp-mac-arm64-apple-metal-advsimd",
  version: "1.50.2",
  engine: "llama.cpp",
  platform: "mac",
  cpu: {
    architecture: "ARM64",
    instructionSetExtensions: ["AdvSIMD"],
  },
  gpu: {
    make: "Apple",
    framework: "Metal",
  },
  supportedModelFormatNames: ["GGUF"],
};

// llama.cpp engine (Windows x86_64, CPU-only)
const llamaCppWindowsRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "llama.cpp-win-x86_64-avx2",
  version: "1.50.2",
  engine: "llama.cpp",
  platform: "win",
  cpu: {
    architecture: "x86_64",
    instructionSetExtensions: ["AVX2"],
  },
  supportedModelFormatNames: ["GGUF"],
};

// llama.cpp engine (Windows x86_64 with AMD ROCm)
const llamaCppWindowsRocmRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "llama.cpp-win-x86_64-amd-rocm-avx2",
  version: "1.50.2",
  engine: "llama.cpp",
  platform: "win",
  cpu: {
    architecture: "x86_64",
    instructionSetExtensions: ["AVX2"],
  },
  gpu: {
    make: "AMD",
    framework: "ROCm",
  },
  supportedModelFormatNames: ["GGUF"],
};

// llama.cpp engine (Windows x86_64 with NVIDIA CUDA) - different version
const llamaCppWindowsCudaOlderRuntimeEngineInfo: RuntimeEngineInfo = {
  name: "llama.cpp-win-x86_64-nvidia-cuda-avx2-older",
  version: "1.50.1",
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

describe("AliasGroup", () => {
  describe("getEnginesWithMinimalAliases", () => {
    it("should return minimal alias for single MLX engine", () => {
      const groups = AliasGroup.createGroups([mlxRuntimeEngineInfo]);
      expect(groups).toHaveLength(1);

      const results = groups[0].getEnginesWithMinimalAliases();
      expect(results).toHaveLength(1);

      const result = results[0];
      expect(result.engine).toBe(mlxRuntimeEngineInfo);
      expect(result.minimalAlias).toBe("mlx-engine@0.26.1");
      expect(result.fullAlias).toBe("mlx-llm-mac-arm64-apple-metal-advsimd-0.26.1");
    });

    it("should return minimal aliases for multiple Windows llama.cpp engines", () => {
      const engines = [
        llamaCppWindowsCudaRuntimeEngineInfo,
        llamaCppWindowsRuntimeEngineInfo,
        llamaCppWindowsRocmRuntimeEngineInfo,
      ];
      const groups = AliasGroup.createGroups(engines);
      expect(groups).toHaveLength(1);

      const results = groups[0].getEnginesWithMinimalAliases();
      expect(results).toHaveLength(3);

      // Find results by engine to avoid order dependency
      const cudaResult = results.find(r => r.engine === llamaCppWindowsCudaRuntimeEngineInfo);
      const cpuResult = results.find(r => r.engine === llamaCppWindowsRuntimeEngineInfo);
      const rocmResult = results.find(r => r.engine === llamaCppWindowsRocmRuntimeEngineInfo);

      expect(cudaResult).toBeDefined();
      expect(cudaResult!.minimalAlias).toBe("llama.cpp-cuda@1.50.2");
      expect(cudaResult!.fullAlias).toBe("llama.cpp-win-x86_64-nvidia-cuda-avx2-1.50.2");

      expect(cpuResult).toBeDefined();
      expect(cpuResult!.minimalAlias).toBe("llama.cpp-cpu@1.50.2");
      expect(cpuResult!.fullAlias).toBe("llama.cpp-win-x86_64-avx2-1.50.2");

      expect(rocmResult).toBeDefined();
      expect(rocmResult!.minimalAlias).toBe("llama.cpp-rocm@1.50.2");
      expect(rocmResult!.fullAlias).toBe("llama.cpp-win-x86_64-amd-rocm-avx2-1.50.2");
    });

    it("should return minimal aliases for Windows CUDA and Mac llama.cpp engines", () => {
      const engines = [llamaCppWindowsCudaRuntimeEngineInfo, llamaCppMacRuntimeEngineInfo];
      const groups = AliasGroup.createGroups(engines);
      expect(groups).toHaveLength(1);

      const results = groups[0].getEnginesWithMinimalAliases();
      expect(results).toHaveLength(2);

      // Find results by engine to avoid order dependency
      const cudaResult = results.find(r => r.engine === llamaCppWindowsCudaRuntimeEngineInfo);
      const macResult = results.find(r => r.engine === llamaCppMacRuntimeEngineInfo);

      expect(cudaResult).toBeDefined();
      expect(cudaResult!.minimalAlias).toBe("llama.cpp-win-x86_64-cuda-avx2@1.50.2");
      expect(cudaResult!.fullAlias).toBe("llama.cpp-win-x86_64-nvidia-cuda-avx2-1.50.2");

      expect(macResult).toBeDefined();
      expect(macResult!.minimalAlias).toBe("llama.cpp-mac-arm64-metal-advsimd@1.50.2");
      expect(macResult!.fullAlias).toBe("llama.cpp-mac-arm64-apple-metal-advsimd-1.50.2");
    });
  });

  describe("resolve", () => {
    const engines = [
      llamaCppWindowsCudaRuntimeEngineInfo,
      llamaCppWindowsCudaOlderRuntimeEngineInfo,
      llamaCppWindowsRuntimeEngineInfo,
    ];
    const group = AliasGroup.createGroups(engines)[0];

    it("should return empty array for non-existent alias", () => {
      const results = group.resolve("non-existent-alias@1.0.0");
      expect(results).toEqual([]);
    });

    it("should return single match for specific alias", () => {
      const results = group.resolve("llama.cpp-cuda@1.50.2");
      expect(results).toHaveLength(1);
      expect(results[0].engine).toBe(llamaCppWindowsCudaRuntimeEngineInfo);
      expect(results[0].matchedAlias.alias).toBe("llama.cpp-cuda@1.50.2");
      expect(results[0].matchedAlias.fields).toEqual(
        new Set(["engine", "gpuFramework", "version"]),
      );
    });

    it("should return multiple matches for shared alias", () => {
      const results = group.resolve("llama.cpp-cuda");
      expect(results).toHaveLength(2);

      // Both CUDA engines should match the cuda alias (without version)
      const engineMatches = results.map(r => r.engine);
      expect(engineMatches).toContain(llamaCppWindowsCudaRuntimeEngineInfo);
      expect(engineMatches).toContain(llamaCppWindowsCudaOlderRuntimeEngineInfo);

      // All should have the same matched alias and fields
      results.forEach(result => {
        expect(result.matchedAlias.alias).toBe("llama.cpp-cuda");
        expect(result.matchedAlias.fields).toEqual(new Set(["engine", "gpuFramework"]));
      });
    });

    it("should resolve full alias to single engine", () => {
      const results = group.resolve("llama.cpp-win-x86_64-nvidia-cuda-avx2-1.50.2");
      expect(results).toHaveLength(1);
      expect(results[0].engine).toBe(llamaCppWindowsCudaRuntimeEngineInfo);
      expect(results[0].matchedAlias.alias).toBe("llama.cpp-win-x86_64-nvidia-cuda-avx2-1.50.2");
      expect(results[0].matchedAlias.fields).toEqual(new Set(["version"]));
    });
  });
});
