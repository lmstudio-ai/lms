import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import { Command } from "@commander-js/extra-typings";

jest.mock("@lmstudio/lms-common-server", () => ({
  findLMStudioHome: jest.fn().mockReturnValue("C:\\non-existent-test-home"),
}));

jest.mock("ink", () => ({
  render: jest.fn().mockReturnValue({
    waitUntilExit: jest.fn().mockResolvedValue(undefined),
    unmount: jest.fn(),
    cleanup: jest.fn(),
  }),
  Box: () => null,
  Text: () => null,
  useApp: () => ({ exit: jest.fn() }),
  useInput: jest.fn(),
}));

import { TopDataCollector } from "./dataFetcher.js";
import { top } from "./index.js";
import { renderProgressBar } from "./renderProgressBar.js";
import * as createClientModule from "../../createClient.js";

const createMockLogger = (): SimpleLogger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    errorWithoutPrefix: jest.fn(),
  }) as unknown as SimpleLogger;

const createMockClient = (overrides: Partial<any> = {}): LMStudioClient => {
  const unsubscribe = jest.fn();
  return {
    diagnostics: {
      unstable_streamLogs: jest.fn().mockReturnValue(unsubscribe),
      ...overrides.diagnostics,
    },
    system: {
      getInfo: jest.fn().mockResolvedValue({ pid: 1234, isDaemon: false }),
      getLMStudioVersion: jest.fn().mockResolvedValue({ version: "0.4.24", build: 42 }),
      listDownloadedModels: jest.fn().mockResolvedValue([]),
      ...overrides.system,
    },
    runtime: {
      surveyHardware: jest.fn().mockResolvedValue({ engines: [] }),
      ...overrides.runtime,
    },
    llm: {
      listLoaded: jest.fn().mockResolvedValue([]),
      ...overrides.llm,
    },
    embedding: {
      listLoaded: jest.fn().mockResolvedValue([]),
      ...overrides.embedding,
    },
    [Symbol.asyncDispose]: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as LMStudioClient;
};

describe("top command configuration and CLI options", () => {
  beforeEach(() => {
    top.exitOverride();
    top.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("has correct command name and description", () => {
    expect(top.name()).toBe("top");
    expect(top.description()).toBe("Real-time system, VRAM, and server throughput dashboard");
  });

  it("registers --interval, --once, and --json options", () => {
    const options = top.options.map(o => o.long);
    expect(options).toContain("--interval");
    expect(options).toContain("--once");
    expect(options).toContain("--json");
  });

  it("accepts valid boundary interval values (250ms and 60000ms)", () => {
    // Test the refined number parser directly via commander option
    const intervalOption = top.options.find(o => o.long === "--interval");
    expect(intervalOption).toBeDefined();
    const parse = intervalOption!.parseArg!;
    expect(parse("250", 1000)).toBe(250);
    expect(parse("60000", 1000)).toBe(60000);
    expect(parse("1000", 1000)).toBe(1000);
  });

  it("rejects interval values less than 250ms", async () => {
    await expect(
      top.parseAsync(["node", "lms", "top", "--interval", "100", "--once"]),
    ).rejects.toThrow("Number out of range, must be at least 250");
  });

  it("rejects interval values greater than 60000ms", async () => {
    await expect(
      top.parseAsync(["node", "lms", "top", "--interval", "100000", "--once"]),
    ).rejects.toThrow("Number out of range, must be at most 60000");
  });

  it("rejects non-integer interval values", async () => {
    await expect(
      top.parseAsync(["node", "lms", "top", "--interval", "1234.5", "--once"]),
    ).rejects.toThrow("Not an integer");
  });

  it("rejects non-numeric interval values", async () => {
    await expect(
      top.parseAsync(["node", "lms", "top", "--interval", "fast", "--once"]),
    ).rejects.toThrow("Not a number");
  });
});

describe("renderProgressBar UI helper", () => {
  it("renders 0% bar with all empty blocks", () => {
    const output = renderProgressBar(0, 20);
    expect(output).toContain("[░░░░░░░░░░░░░░░░░░░░]");
    expect(output).toContain("0.0%");
  });

  it("renders 50% bar with half filled blocks", () => {
    const output = renderProgressBar(0.5, 20);
    expect(output).toContain("[██████████░░░░░░░░░░]");
    expect(output).toContain("50.0%");
  });

  it("renders 100% bar with all filled blocks", () => {
    const output = renderProgressBar(1.0, 20);
    expect(output).toContain("[████████████████████]");
    expect(output).toContain("100.0%");
  });

  it("clamps negative ratio to 0.0%", () => {
    const output = renderProgressBar(-0.25, 20);
    expect(output).toContain("[░░░░░░░░░░░░░░░░░░░░]");
    expect(output).toContain("0.0%");
  });

  it("clamps ratio greater than 1 to 100.0%", () => {
    const output = renderProgressBar(1.75, 20);
    expect(output).toContain("[████████████████████]");
    expect(output).toContain("100.0%");
  });

  it("handles NaN safely by clamping to 0.0%", () => {
    const output = renderProgressBar(NaN, 20);
    expect(output).toContain("[░░░░░░░░░░░░░░░░░░░░]");
    expect(output).toContain("0.0%");
  });
});

describe("TopDataCollector - model name resolution heuristics", () => {
  let collector: TopDataCollector;

  beforeEach(() => {
    const client = createMockClient();
    const logger = createMockLogger();
    collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);
  });

  it("resolves popular model families from path", () => {
    expect(collector.resolveModelName("C:\\models\\DeepSeek-R1-Distill-Qwen-7B.gguf")).toBe(
      "deepseek-r1-distill-qwen-7b",
    );
    expect(collector.resolveModelName("/home/user/models/google_gemma_4_12b_qat.gguf")).toBe(
      "google/gemma-4-12b-qat",
    );
    expect(collector.resolveModelName("models/qwen2.5-7b-instruct.gguf")).toBe("qwen");
    expect(collector.resolveModelName("models/meta-llama-3.1-8b.gguf")).toBe("llama");
  });

  it("resolves based on updated known models mapping", () => {
    collector.updateKnownModels(
      [{ modelKey: "mistralai/Mistral-7B-Instruct-v0.3", path: "C:/models/mistral-7b.gguf" }],
      [
        {
          identifier: "custom-loaded-phi3",
          modelKey: "microsoft/Phi-3-mini-4k-instruct",
          type: "llm",
          sizeBytes: 2000000,
          contextLength: 4096,
          parallel: 1,
          status: "IDLE",
          queued: 0,
        },
      ],
    );

    expect(collector.resolveModelName("C:/models/mistral-7b.gguf")).toBe(
      "mistralai/Mistral-7B-Instruct-v0.3",
    );
    expect(collector.resolveModelName("C:/cache/phi-3-mini.gguf")).toBe("custom-loaded-phi3");
  });

  it("falls back to file basename when no keyword matches", () => {
    expect(collector.resolveModelName("C:\\Users\\LMStudio\\models\\my-experimental-net.gguf")).toBe(
      "my-experimental-net",
    );
  });

  it("falls back to defaultName when path is empty or root", () => {
    expect(collector.resolveModelName("", "FallbackLLM")).toBe("FallbackLLM");
  });
});

describe("TopDataCollector - engine log chunk parsing & throughput metrics", () => {
  let collector: TopDataCollector;

  beforeEach(() => {
    const client = createMockClient();
    const logger = createMockLogger();
    collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);
  });

  it("parses single completion timing and updates metrics", () => {
    const logChunk = [
      "[2026-09-16 19:15:30] [info] slot print_timing: prompt eval time = 120.50 ms / 50 tokens (2.41 ms per token, 414.94 tokens per second)",
      "[2026-09-16 19:15:31] [info] slot print_timing:        eval time = 800.00 ms / 20 tokens (40.00 ms per token, 25.00 tokens per second)",
      "[2026-09-16 19:15:31] [info] slot print_timing:       total time = 920.50 ms / 70 tokens",
    ].join("\n");

    collector.parseLogChunk(logChunk, "default-llm");
    const metrics = collector.getThroughputMetrics();

    expect(metrics.currentTokensPerSec).toBe(25);
    expect(metrics.avgTokensPerSec).toBe(25);
    expect(metrics.totalTokensGenerated).toBe(20);
    expect(metrics.totalPromptTokens).toBe(50);
    expect(metrics.lastTtftSec).toBeCloseTo(0.1205, 4);

    expect(metrics.recentPredictions).toHaveLength(1);
    const rec = metrics.recentPredictions[0];
    expect(rec.modelIdentifier).toBe("default-llm");
    expect(rec.promptTokens).toBe(50);
    expect(rec.predictedTokens).toBe(20);
    expect(rec.totalTokens).toBe(70);
    expect(rec.tokensPerSecond).toBe(25);
    expect(rec.ttftSec).toBeCloseTo(0.1205, 4);
    expect(rec.totalTimeSec).toBeCloseTo(0.9205, 4);
  });

  it("accurately maintains distinct model attribution when switching models without mutating history", () => {
    // Model A: DeepSeek loaded and generates a completion
    const chunkA = [
      "[2026-09-16 19:00:00] [info] srv load_model: loading model 'C:\\models\\DeepSeek-R1-Distill-Qwen-7B\\model.gguf'",
      "[2026-09-16 19:00:05] [info] slot print_timing: prompt eval time = 100.00 ms / 40 tokens (2.50 ms per token, 400.00 tokens per second)",
      "[2026-09-16 19:00:06] [info] slot print_timing:        eval time = 500.00 ms / 25 tokens (20.00 ms per token, 50.00 tokens per second)",
      "[2026-09-16 19:00:06] [info] slot print_timing:       total time = 600.00 ms / 65 tokens",
    ].join("\n");

    collector.parseLogChunk(chunkA, "fallback");

    let metrics = collector.getThroughputMetrics();
    expect(metrics.recentPredictions).toHaveLength(1);
    expect(metrics.recentPredictions[0].modelIdentifier).toBe("deepseek-r1-distill-qwen-7b");
    expect(metrics.recentPredictions[0].predictedTokens).toBe(25);

    // Model B: Gemma loaded and generates another completion
    const chunkB = [
      "[2026-09-16 19:05:00] [info] srv load_model: loading model 'C:\\models\\google\\gemma-4-12b-qat\\model.gguf'",
      "[2026-09-16 19:05:05] [info] slot print_timing: prompt eval time = 80.00 ms / 30 tokens (2.67 ms per token, 375.00 tokens per second)",
      "[2026-09-16 19:05:06] [info] slot print_timing:        eval time = 400.00 ms / 16 tokens (25.00 ms per token, 40.00 tokens per second)",
      "[2026-09-16 19:05:06] [info] slot print_timing:       total time = 480.00 ms / 46 tokens",
    ].join("\n");

    collector.parseLogChunk(chunkB, "fallback");

    metrics = collector.getThroughputMetrics();
    expect(metrics.recentPredictions).toHaveLength(2);

    // Most recent completion is Gemma
    expect(metrics.recentPredictions[0].modelIdentifier).toBe("google/gemma-4-12b-qat");
    expect(metrics.recentPredictions[0].tokensPerSecond).toBe(40);

    // Previous completion in history MUST still be DeepSeek (not overwritten)
    expect(metrics.recentPredictions[1].modelIdentifier).toBe("deepseek-r1-distill-qwen-7b");
    expect(metrics.recentPredictions[1].tokensPerSecond).toBe(50);

    // Total tokens and rolling average calculation
    expect(metrics.totalTokensGenerated).toBe(25 + 16);
    expect(metrics.totalPromptTokens).toBe(40 + 30);
    expect(metrics.currentTokensPerSec).toBe(40);
    expect(metrics.avgTokensPerSec).toBe((50 + 40) / 2);
  });

  it("caps recent history to 20 records and recentPredictions to 5", () => {
    for (let i = 1; i <= 25; i++) {
      const chunk = [
        `[2026-09-16 19:20:${String(i).padStart(2, "0")}] [info] slot print_timing: prompt eval time = 50.00 ms / 10 tokens`,
        `[2026-09-16 19:20:${String(i).padStart(2, "0")}] [info] slot print_timing:        eval time = 200.00 ms / 10 tokens (20.00 ms per token, 50.00 tokens per second)`,
        `[2026-09-16 19:20:${String(i).padStart(2, "0")}] [info] slot print_timing:       total time = 250.00 ms / 20 tokens`,
      ].join("\n");
      collector.parseLogChunk(chunk, `model-${i}`);
    }

    const metrics = collector.getThroughputMetrics();
    expect(metrics.recentPredictions).toHaveLength(5);
    // Most recent was model-25
    expect(metrics.recentPredictions[0].modelIdentifier).toBe("model-25");
    expect(metrics.recentPredictions[4].modelIdentifier).toBe("model-21");
    expect(metrics.totalTokensGenerated).toBe(25 * 10);
  });

  it("ignores incomplete timing blocks where total time is not logged", () => {
    const incompleteChunk = [
      "[2026-09-16 19:15:30] [info] slot print_timing: prompt eval time = 120.50 ms / 50 tokens (2.41 ms per token, 414.94 tokens per second)",
    ].join("\n");

    collector.parseLogChunk(incompleteChunk, "default-llm");
    const metrics = collector.getThroughputMetrics();
    expect(metrics.recentPredictions).toHaveLength(0);
    expect(metrics.totalTokensGenerated).toBe(0);
  });

  it("computes fallback tokens per second when rate in parentheses is omitted", () => {
    const chunk = [
      "[2026-09-16 19:15:30] [info] slot print_timing: prompt eval time = 100.00 ms / 20 tokens",
      "[2026-09-16 19:15:31] [info] slot print_timing:        eval time = 500.00 ms / 25 tokens",
      "[2026-09-16 19:15:31] [info] slot print_timing:       total time = 600.00 ms / 45 tokens",
    ].join("\n");

    collector.parseLogChunk(chunk, "test-model");
    const metrics = collector.getThroughputMetrics();
    // 25 tokens / 0.5s = 50 tokens per second
    expect(metrics.currentTokensPerSec).toBeCloseTo(50, 1);
    expect(metrics.recentPredictions[0].tokensPerSecond).toBeCloseTo(50, 1);
  });
});

describe("TopDataCollector - diagnostics stream log events", () => {
  let mockStreamLogs: jest.Mock;
  let unsubscribeFn: jest.Mock;
  let collector: TopDataCollector;

  beforeEach(() => {
    unsubscribeFn = jest.fn();
    mockStreamLogs = jest.fn().mockReturnValue(unsubscribeFn);
    const client = createMockClient({
      diagnostics: { unstable_streamLogs: mockStreamLogs },
    });
    const logger = createMockLogger();
    collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);
  });

  it("subscribes on startListening and unsubscribes on stopListening", () => {
    collector.startListening();
    expect(mockStreamLogs).toHaveBeenCalledTimes(1);

    collector.stopListening();
    expect(unsubscribeFn).toHaveBeenCalledTimes(1);
  });

  it("handles streamLogs error gracefully without throwing", () => {
    const errorClient = createMockClient({
      diagnostics: {
        unstable_streamLogs: jest.fn().mockImplementation(() => {
          throw new Error("Permission denied for guest client");
        }),
      },
    });
    const logger = createMockLogger();
    const errorCollector = new TopDataCollector(errorClient, logger, "127.0.0.1", 1234);

    expect(() => errorCollector.startListening()).not.toThrow();
  });

  it("tracks in-flight predictions via stream log events", () => {
    collector.startListening();
    const handler = mockStreamLogs.mock.calls[0][0];

    // Prediction starts
    handler({
      timestamp: Date.now(),
      data: { type: "llm.prediction.input" },
    });
    expect(collector.getThroughputMetrics().activePredictions).toBe(1);

    // Another prediction starts
    handler({
      timestamp: Date.now(),
      data: { type: "llm.prediction.input" },
    });
    expect(collector.getThroughputMetrics().activePredictions).toBe(2);

    // One prediction finishes with stats
    handler({
      timestamp: Date.now(),
      data: {
        type: "llm.prediction.output",
        modelIdentifier: "gemma-2-9b",
        stats: {
          promptTokensCount: 15,
          predictedTokensCount: 30,
          totalTokensCount: 45,
          tokensPerSecond: 35.5,
          timeToFirstTokenSec: 0.15,
          totalTimeSec: 0.99,
          stopReason: "eosFound",
        },
      },
    });

    const metrics = collector.getThroughputMetrics();
    expect(metrics.activePredictions).toBe(1);
    expect(metrics.currentTokensPerSec).toBe(35.5);
    expect(metrics.totalTokensGenerated).toBe(30);
    expect(metrics.totalPromptTokens).toBe(15);
    expect(metrics.lastTtftSec).toBe(0.15);
    expect(metrics.recentPredictions).toHaveLength(1);
    expect(metrics.recentPredictions[0].modelIdentifier).toBe("gemma-2-9b");
    expect(metrics.recentPredictions[0].stopReason).toBe("eosFound");
  });
});

describe("TopDataCollector - snapshot fetching", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns offline snapshot when server is unreachable", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection refused"));
    const client = createMockClient();
    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    const snapshot = await collector.fetchSnapshot();
    expect(snapshot.server.status).toBe("offline");
    expect(snapshot.server.pid).toBeNull();
    expect(snapshot.server.version).toBeNull();
    expect(snapshot.loadedModels).toEqual([]);
    expect(snapshot.throughput.activePredictions).toBe(0);
  });

  it("returns online snapshot with hardware, loaded models, and processing states", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({ lmstudio: true }),
    } as any);

    const mockLlmModel = {
      identifier: "google/gemma-4-12b-qat",
      getModelInfo: jest.fn().mockResolvedValue({
        modelKey: "google/gemma-4-12b-qat",
        architecture: "gemma",
        paramsString: "12B",
        format: "gguf",
        sizeBytes: 8000000000,
        ttlMs: 3600000,
        lastUsedTime: 1726500000000,
        deviceIdentifier: "cuda:0",
      }),
      getLoadConfig: jest.fn().mockResolvedValue({
        maxParallelPredictions: 4,
      }),
      getInstanceProcessingState: jest.fn().mockResolvedValue({
        status: "processing",
        queued: 2,
      }),
      getContextLength: jest.fn().mockResolvedValue(8192),
    };

    const mockEmbeddingModel = {
      identifier: "nomic-embed-text",
      getModelInfo: jest.fn().mockResolvedValue({
        modelKey: "nomic-ai/nomic-embed-text-v1.5",
        architecture: "bert",
        paramsString: "137M",
        format: "gguf",
        sizeBytes: 274000000,
        ttlMs: null,
        lastUsedTime: null,
        deviceIdentifier: "cpu",
      }),
      getInstanceProcessingState: jest.fn().mockResolvedValue({
        status: "idle",
        queued: 0,
      }),
      getContextLength: jest.fn().mockResolvedValue(2048),
    };

    const client = createMockClient({
      system: {
        getInfo: jest.fn().mockResolvedValue({ pid: 7848, isDaemon: true }),
        getLMStudioVersion: jest.fn().mockResolvedValue({ version: "0.4.24", build: 100 }),
        listDownloadedModels: jest.fn().mockResolvedValue([]),
      },
      runtime: {
        surveyHardware: jest.fn().mockResolvedValue({
          engines: [
            {
              hardwareSurvey: {
                gpuSurveyResult: {
                  gpuInfo: [
                    {
                      name: "NVIDIA RTX 2060",
                      detectionPlatform: "cuda",
                      integrationType: "discrete",
                      dedicatedMemoryCapacityBytes: 6 * 1024 * 1024 * 1024,
                      totalMemoryCapacityBytes: 6 * 1024 * 1024 * 1024,
                    },
                  ],
                },
                cpuSurveyResult: {
                  cpuInfo: {
                    architecture: "x86_64",
                    supportedInstructionSetExtensions: ["avx2"],
                  },
                },
              },
              memoryInfo: {
                ramCapacity: 16 * 1024 * 1024 * 1024,
                vramCapacity: 6 * 1024 * 1024 * 1024,
              },
            },
          ],
        }),
      },
      llm: {
        listLoaded: jest.fn().mockResolvedValue([mockLlmModel]),
      },
      embedding: {
        listLoaded: jest.fn().mockResolvedValue([mockEmbeddingModel]),
      },
    });

    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    const snapshot = await collector.fetchSnapshot();

    expect(snapshot.server.status).toBe("online");
    expect(snapshot.server.pid).toBe(7848);
    expect(snapshot.server.version).toBe("0.4.24");

    // Hardware survey
    expect(snapshot.hardware).not.toBeNull();
    expect(snapshot.hardware?.gpus[0].name).toBe("NVIDIA RTX 2060");
    expect(snapshot.hardware?.cpuArchitecture).toBe("x86_64");

    // Loaded models
    expect(snapshot.loadedModels).toHaveLength(2);
    expect(snapshot.loadedModels[0].identifier).toBe("google/gemma-4-12b-qat");
    expect(snapshot.loadedModels[0].parallel).toBe(4);
    expect(snapshot.loadedModels[0].status).toBe("PROCESSING");
    expect(snapshot.loadedModels[0].queued).toBe(2);

    expect(snapshot.loadedModels[1].identifier).toBe("nomic-embed-text");
    expect(snapshot.loadedModels[1].type).toBe("embedding");
    expect(snapshot.loadedModels[1].status).toBe("IDLE");

    // Active predictions from processing states: 1 (processing) + 2 (queued) = 3
    expect(snapshot.throughput.activePredictions).toBe(3);
  });

  it("handles service info and hardware survey failures gracefully", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({ lmstudio: true }),
    } as any);

    const client = createMockClient({
      system: {
        getInfo: jest.fn().mockRejectedValue(new Error("RPC failed")),
        getLMStudioVersion: jest.fn().mockRejectedValue(new Error("RPC failed")),
        listDownloadedModels: jest.fn().mockResolvedValue([]),
      },
      runtime: {
        surveyHardware: jest.fn().mockRejectedValue(new Error("Survey failed")),
      },
    });

    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    const snapshot = await collector.fetchSnapshot();
    expect(snapshot.server.status).toBe("online");
    expect(snapshot.server.pid).toBeNull();
    expect(snapshot.server.version).toBeNull();
    expect(snapshot.hardware).toBeNull();
  });
});
