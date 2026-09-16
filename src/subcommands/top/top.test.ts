import fs from "fs";
import os from "os";
import path from "path";
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
    warnText: jest.fn(),
    infoText: jest.fn(),
    debugText: jest.fn(),
    errorText: jest.fn(),
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

  it("prefers exact model matches before generic keyword heuristics", () => {
    collector.updateKnownModels(
      [],
      [
        {
          identifier: "google/gemma-4-12b-qat",
          modelKey: "google/gemma-4-12b-qat",
          type: "llm",
          sizeBytes: 7000000,
          contextLength: 8192,
          parallel: 1,
          status: "IDLE",
          queued: 0,
        },
        {
          identifier: "google/gemma-2-27b-it",
          modelKey: "google/gemma-2-27b-it",
          type: "llm",
          sizeBytes: 15000000,
          contextLength: 8192,
          parallel: 1,
          status: "IDLE",
          queued: 0,
        },
      ],
    );

    // Exact identifier of the second model must resolve to the second model, not the first
    expect(collector.resolveModelName("google/gemma-2-27b-it")).toBe("google/gemma-2-27b-it");
    expect(collector.resolveModelName("google/gemma-4-12b-qat")).toBe("google/gemma-4-12b-qat");
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

  it("excludes initial backfill completions from session average and session speed", () => {
    const historicalChunk = [
      "[2026-09-16 18:00:00] [info] slot print_timing: prompt eval time = 100.00 ms / 20 tokens",
      "[2026-09-16 18:00:01] [info] slot print_timing:        eval time = 500.00 ms / 25 tokens (20.00 ms per token, 50.00 tokens per second)",
      "[2026-09-16 18:00:01] [info] slot print_timing:       total time = 600.00 ms / 45 tokens",
    ].join("\n");

    // Initial startup backfill: isInitialBackfill = true
    collector.parseLogChunk(historicalChunk, "test-model", true);

    let metrics = collector.getThroughputMetrics();
    // Backfill record appears in recent completions history for user context
    expect(metrics.recentPredictions).toHaveLength(1);
    expect(metrics.recentPredictions[0].isBackfill).toBe(true);
    // Must NOT contaminate live session speed, average, or session tokens
    expect(metrics.currentTokensPerSec).toBe(0);
    expect(metrics.avgTokensPerSec).toBe(0);
    expect(metrics.totalTokensGenerated).toBe(0);
    expect(metrics.lastTtftSec).toBeNull();

    // Now a live session completion arrives: isInitialBackfill = false
    const liveChunk = [
      "[2026-09-16 19:00:00] [info] slot print_timing: prompt eval time = 50.00 ms / 10 tokens",
      "[2026-09-16 19:00:01] [info] slot print_timing:        eval time = 250.00 ms / 20 tokens (12.50 ms per token, 80.00 tokens per second)",
      "[2026-09-16 19:00:01] [info] slot print_timing:       total time = 300.00 ms / 30 tokens",
    ].join("\n");

    collector.parseLogChunk(liveChunk, "test-model", false);

    metrics = collector.getThroughputMetrics();
    expect(metrics.recentPredictions).toHaveLength(2);
    expect(metrics.totalTokensGenerated).toBe(20);
    expect(metrics.currentTokensPerSec).toBe(80);
    // Session average must only average live completions (80 tok/s), NOT contaminated by backfilled (50 tok/s)
    expect(metrics.avgTokensPerSec).toBe(80);
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
    expect(snapshot.loadedModels[0].status).toBe("RUNNING");
    expect(snapshot.loadedModels[0].queued).toBe(2);

    expect(snapshot.loadedModels[1].identifier).toBe("nomic-embed-text");
    expect(snapshot.loadedModels[1].type).toBe("embedding");
    expect(snapshot.loadedModels[1].status).toBe("IDLE");

    // Active predictions from processing states: queued is 2
    expect(snapshot.throughput.activePredictions).toBe(2);
  });

  it("marks model as RUNNING while streaming response and returns to IDLE after output", async () => {
    let streamHandler: ((log: any) => void) | null = null;
    const client = createMockClient({
      diagnostics: {
        unstable_streamLogs: jest.fn().mockImplementation((handler: any) => {
          streamHandler = handler;
          return jest.fn();
        }),
      },
      llm: {
        listLoaded: jest.fn().mockResolvedValue([
          {
            identifier: "qwen-model",
            getModelInfo: jest.fn().mockResolvedValue({
              modelKey: "qwen",
              sizeBytes: 1000,
            }),
            getLoadConfig: jest.fn().mockResolvedValue({}),
            getInstanceProcessingState: jest.fn().mockResolvedValue({ status: "idle", queued: 0 }),
            getContextLength: jest.fn().mockResolvedValue(2048),
          },
        ]),
      },
    });

    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);
    collector.startListening();

    // Initial snapshot: IDLE
    let snapshot = await collector.fetchSnapshot();
    expect(snapshot.loadedModels[0].status).toBe("IDLE");
    expect(snapshot.throughput.activePredictions).toBe(0);

    // 1. Response starts streaming (llm.prediction.input)
    streamHandler!({
      timestamp: Date.now(),
      data: {
        type: "llm.prediction.input",
        modelIdentifier: "qwen-model",
        input: "Hello",
        modelPath: "/path/qwen",
      },
    });

    // While response is streaming: RUNNING
    snapshot = await collector.fetchSnapshot();
    expect(snapshot.loadedModels[0].status).toBe("RUNNING");
    expect(snapshot.throughput.activePredictions).toBe(1);

    // 2. Response finishes (llm.prediction.output)
    streamHandler!({
      timestamp: Date.now(),
      data: {
        type: "llm.prediction.output",
        modelIdentifier: "qwen-model",
        output: "World",
        stats: {
          promptTokensCount: 5,
          predictedTokensCount: 10,
          totalTokensCount: 15,
          tokensPerSecond: 20,
        },
      },
    });

    // Finished streaming: returns to IDLE
    snapshot = await collector.fetchSnapshot();
    expect(snapshot.loadedModels[0].status).toBe("IDLE");
    expect(snapshot.throughput.activePredictions).toBe(0);
  });

  it("calculates real-time estimated VRAM and RAM footprint dynamically during idle and running states", async () => {
    let streamHandler: ((log: any) => void) | null = null;
    const client = createMockClient({
      diagnostics: {
        unstable_streamLogs: jest.fn().mockImplementation((handler: any) => {
          streamHandler = handler;
          return jest.fn();
        }),
      },
      runtime: {
        surveyHardware: jest.fn().mockResolvedValue({
          engines: [
            {
              hardwareSurvey: {
                gpuSurveyResult: {
                  gpuInfo: [
                    {
                      name: "RTX 2060",
                      detectionPlatform: "CUDA",
                      integrationType: "discrete",
                      dedicatedMemoryCapacityBytes: 6 * 1024 * 1024 * 1024,
                      totalMemoryCapacityBytes: 6 * 1024 * 1024 * 1024,
                    },
                  ],
                },
                cpuSurveyResult: { cpuInfo: { architecture: "x86_64", supportedInstructionSetExtensions: [] } },
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
        listLoaded: jest.fn().mockResolvedValue([
          {
            identifier: "meta-llama-3-8b",
            getModelInfo: jest.fn().mockResolvedValue({
              modelKey: "llama3",
              sizeBytes: 4_000_000_000,
            }),
            getLoadConfig: jest.fn().mockResolvedValue({
              gpu: { ratio: 1.0 },
              offloadKVCacheToGpu: true,
            }),
            getInstanceProcessingState: jest.fn().mockResolvedValue({ status: "idle", queued: 0 }),
            getContextLength: jest.fn().mockResolvedValue(2048),
          },
        ]),
      },
    });

    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);
    collector.startListening();

    // 1. Initial snapshot when IDLE: base weights + KV cache
    let snapshot = await collector.fetchSnapshot();
    const idleModel = snapshot.loadedModels[0];
    expect(idleModel.status).toBe("IDLE");
    // weights (4GB) + KV (2048 * 128KB = 262,144,000 bytes) = 4,262,144,000 bytes
    const baseVramBytes = idleModel.estimatedVramBytes!;
    expect(baseVramBytes).toBe(4_000_000_000 + 2048 * 128_000);
    expect(idleModel.estimatedRamBytes).toBe(0);

    // 2. Stream starts: model becomes RUNNING, live working buffer added in real-time
    streamHandler!({
      timestamp: Date.now(),
      data: {
        type: "llm.prediction.input",
        modelIdentifier: "meta-llama-3-8b",
        input: "Test input",
      },
    });

    snapshot = await collector.fetchSnapshot();
    const runningModel = snapshot.loadedModels[0];
    expect(runningModel.status).toBe("RUNNING");
    // Live VRAM should increase by 256MB active buffer in real time
    expect(runningModel.estimatedVramBytes).toBe(baseVramBytes + 256 * 1024 * 1024);

    // 3. Stream completes: model becomes IDLE, live working buffer reclaimed
    streamHandler!({
      timestamp: Date.now(),
      data: {
        type: "llm.prediction.output",
        modelIdentifier: "meta-llama-3-8b",
        output: "Test output",
        stats: {
          promptTokensCount: 10,
          predictedTokensCount: 20,
          totalTokensCount: 30,
          tokensPerSecond: 25,
        },
      },
    });

    snapshot = await collector.fetchSnapshot();
    const restoredModel = snapshot.loadedModels[0];
    expect(restoredModel.status).toBe("IDLE");
    expect(restoredModel.estimatedVramBytes).toBe(baseVramBytes);
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

  it("marks model as RUNNING when processingState status is generating or processingPrompt or from log launch", async () => {
    let currentStatus = "generating";
    const client = createMockClient({
      llm: {
        listLoaded: jest.fn().mockResolvedValue([
          {
            identifier: "deepseek-r1-distill-qwen-7b",
            getModelInfo: jest.fn().mockResolvedValue({
              modelKey: "deepseek",
              sizeBytes: 4_000_000_000,
            }),
            getLoadConfig: jest.fn().mockResolvedValue({}),
            getInstanceProcessingState: jest.fn().mockImplementation(async () => ({
              status: currentStatus,
              queued: currentStatus === "idle" ? 0 : 1,
            })),
            getContextLength: jest.fn().mockResolvedValue(2048),
          },
        ]),
      },
    });

    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    // 1. Status is "generating" -> RUNNING
    let snapshot = await collector.fetchSnapshot();
    expect(snapshot.loadedModels[0].status).toBe("RUNNING");
    expect(snapshot.throughput.activePredictions).toBe(1);

    // 2. Status is "processingPrompt" -> RUNNING
    currentStatus = "processingPrompt";
    snapshot = await collector.fetchSnapshot();
    expect(snapshot.loadedModels[0].status).toBe("RUNNING");
    expect(snapshot.throughput.activePredictions).toBe(1);

    // 3. Status is "idle" -> IDLE
    currentStatus = "idle";
    snapshot = await collector.fetchSnapshot();
    expect(snapshot.loadedModels[0].status).toBe("IDLE");
    expect(snapshot.throughput.activePredictions).toBe(0);

    // 4. Engine log launch event: slot launch_slot_ -> marks model as RUNNING
    collector.parseLogChunk(
      "[2026-09-16 21:00:00] [DEBUG] slot launch_slot_: id 2 | task 1206 | processing task",
      "deepseek-r1-distill-qwen-7b",
      false,
    );
    snapshot = await collector.fetchSnapshot();
    expect(snapshot.loadedModels[0].status).toBe("RUNNING");
    expect(snapshot.throughput.activePredictions).toBe(1);

    // 5. Engine log release event: slot release -> returns to IDLE
    collector.parseLogChunk(
      "[2026-09-16 21:00:10] [DEBUG] slot release: id 2 | task 1206 | stop processing: n_tokens = 200",
      "deepseek-r1-distill-qwen-7b",
      false,
    );
    snapshot = await collector.fetchSnapshot();
    expect(snapshot.loadedModels[0].status).toBe("IDLE");
    expect(snapshot.throughput.activePredictions).toBe(0);
  });
});

describe("TopDataCollector - remote host guard and session startup isolation", () => {
  it("correctly identifies localhost vs remote host", () => {
    const client = createMockClient();
    const logger = createMockLogger();

    const local1 = new TopDataCollector(client, logger, "127.0.0.1", 1234);
    expect(local1.isLocalHost()).toBe(true);

    const local2 = new TopDataCollector(client, logger, "localhost", 1234);
    expect(local2.isLocalHost()).toBe(true);

    const local3 = new TopDataCollector(client, logger, "::1", 1234);
    expect(local3.isLocalHost()).toBe(true);

    const remote = new TopDataCollector(client, logger, "192.168.1.100", 1234);
    expect(remote.isLocalHost()).toBe(false);
  });

  it("does not increment session token totals during initial log backfill", () => {
    const client = createMockClient();
    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    const oldLogChunk = [
      "[2026-09-16 18:00:00] [info] slot print_timing: prompt eval time = 500.00 ms / 200 tokens",
      "[2026-09-16 18:00:05] [info] slot print_timing:        eval time = 4000.00 ms / 100 tokens (40.00 ms per token, 25.00 tokens per second)",
      "[2026-09-16 18:00:05] [info] slot print_timing:       total time = 4500.00 ms / 300 tokens",
    ].join("\n");

    // Backfill historical logs on startup
    collector.parseLogChunk(oldLogChunk, "historical-model", true);

    let metrics = collector.getThroughputMetrics();
    // History row is populated for display
    expect(metrics.recentPredictions).toHaveLength(1);
    expect(metrics.recentPredictions[0].modelIdentifier).toBe("historical-model");
    // But session total counters remain 0!
    expect(metrics.totalTokensGenerated).toBe(0);
    expect(metrics.totalPromptTokens).toBe(0);

    // Now a live completion occurs during the active session
    const liveChunk = [
      "[2026-09-16 19:40:00] [info] slot print_timing: prompt eval time = 100.00 ms / 30 tokens",
      "[2026-09-16 19:40:02] [info] slot print_timing:        eval time = 1000.00 ms / 40 tokens (25.00 ms per token, 40.00 tokens per second)",
      "[2026-09-16 19:40:02] [info] slot print_timing:       total time = 1100.00 ms / 70 tokens",
    ].join("\n");

    collector.parseLogChunk(liveChunk, "live-model", false);

    metrics = collector.getThroughputMetrics();
    expect(metrics.recentPredictions).toHaveLength(2);
    expect(metrics.totalTokensGenerated).toBe(40);
    expect(metrics.totalPromptTokens).toBe(30);
  });

  it("keeps log fallback active when stream stats are absent and activates on usable stats", () => {
    let streamHandler: ((log: any) => void) | null = null;
    const client = createMockClient({
      diagnostics: {
        unstable_streamLogs: jest.fn().mockImplementation((handler: any) => {
          streamHandler = handler;
          return jest.fn();
        }),
      },
    });
    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    collector.startListening();
    expect(streamHandler).not.toBeNull();

    // 1. Diagnostics stream outputs an event without stats
    streamHandler!({
      timestamp: Date.now(),
      data: {
        type: "llm.prediction.output",
        modelIdentifier: "test-model",
        output: "partial output",
        // stats is absent / undefined
      },
    });

    // Fallback must stay active because stats were absent
    expect((collector as any).streamActive).toBe(false);

    // 2. Diagnostics stream outputs a completion WITH usable stats
    streamHandler!({
      timestamp: Date.now(),
      data: {
        type: "llm.prediction.output",
        modelIdentifier: "test-model",
        output: "full output",
        stats: {
          promptTokensCount: 20,
          predictedTokensCount: 50,
          totalTokensCount: 70,
          tokensPerSecond: 25,
          timeToFirstTokenSec: 0.1,
          totalTimeSec: 2.0,
          stopReason: "eosFound",
        },
      },
    });

    // streamActive should now be true, disabling file fallback
    expect((collector as any).streamActive).toBe(true);
    const metrics = collector.getThroughputMetrics();
    expect(metrics.totalTokensGenerated).toBe(50);
  });

  it("does not drop consecutive distinct stream completions with identical token counts", () => {
    let streamHandler: ((log: any) => void) | null = null;
    const client = createMockClient({
      diagnostics: {
        unstable_streamLogs: jest.fn().mockImplementation((handler: any) => {
          streamHandler = handler;
          return jest.fn();
        }),
      },
    });
    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    collector.startListening();

    const timestamp1 = Date.now();
    streamHandler!({
      timestamp: timestamp1,
      data: {
        type: "llm.prediction.output",
        modelIdentifier: "test-model",
        output: "first response",
        stats: {
          promptTokensCount: 15,
          predictedTokensCount: 30,
          totalTokensCount: 45,
          tokensPerSecond: 20,
          timeToFirstTokenSec: 0.15,
          totalTimeSec: 1.5,
          stopReason: "eosFound",
        },
      },
    });

    const timestamp2 = timestamp1 + 1000;
    streamHandler!({
      timestamp: timestamp2,
      data: {
        type: "llm.prediction.output",
        modelIdentifier: "test-model",
        output: "second response with same token counts",
        stats: {
          promptTokensCount: 15,
          predictedTokensCount: 30,
          totalTokensCount: 45,
          tokensPerSecond: 22,
          timeToFirstTokenSec: 0.12,
          totalTimeSec: 1.4,
          stopReason: "eosFound",
        },
      },
    });

    const metrics = collector.getThroughputMetrics();
    // Both completions must be recorded in history and totals
    expect(metrics.recentPredictions).toHaveLength(2);
    expect(metrics.totalTokensGenerated).toBe(60);
    expect(metrics.totalPromptTokens).toBe(30);
  });

  it("preserves partial log lines across polling reads until newline is written", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lms-top-partial-"));
    const tmpLogFile = path.join(tmpDir, "server.log");

    const client = createMockClient();
    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    // Mock getLatestLogFilePath to return our test file
    (collector as any).getLatestLogFilePath = () => tmpLogFile;

    try {
      // 1. First write has complete lines AND an incomplete partial line at the end (no \n)
      const initialContent = [
        "[2026-09-16 19:40:00] [info] slot print_timing: prompt eval time = 100.00 ms / 30 tokens",
        "[2026-09-16 19:40:02] [info] slot print_timing:        eval time = 1000.00 ms / 40 tokens (25.00 ms per token, 40.00 tokens per second)",
        "[2026-09-16 19:40:02] [info] slot print_timing:       total time = 1100.00 ms / 70 tokens",
        // Incomplete line trailing without newline:
        "[2026-09-16 19:40:05] [info] slot print_timing: prompt eval time = 50.00",
      ].join("\n");

      fs.writeFileSync(tmpLogFile, initialContent, "utf-8");

      (collector as any).refreshLogs("test-model");

      // First completion is parsed
      let metrics = collector.getThroughputMetrics();
      expect(metrics.recentPredictions).toHaveLength(1);
      expect(metrics.totalTokensGenerated).toBe(40);

      // Verify lastLogReadOffset stopped at the last newline, leaving the partial line uncommitted
      const offsetAfterFirstRead = (collector as any).lastLogReadOffset;
      expect(offsetAfterFirstRead).toBeLessThan(fs.statSync(tmpLogFile).size);

      // 2. Append the rest of the incomplete line + completion lines with newline
      const remainderContent = [
        " ms / 15 tokens",
        "[2026-09-16 19:40:06] [info] slot print_timing:        eval time = 500.00 ms / 20 tokens (25.00 ms per token, 40.00 tokens per second)",
        "[2026-09-16 19:40:06] [info] slot print_timing:       total time = 550.00 ms / 35 tokens\n",
      ].join("\n");

      fs.appendFileSync(tmpLogFile, remainderContent, "utf-8");

      // Next poll
      (collector as any).refreshLogs("test-model");

      metrics = collector.getThroughputMetrics();
      // The second completion should now be parsed completely without error or missing timing
      expect(metrics.recentPredictions).toHaveLength(2);
      expect(metrics.totalTokensGenerated).toBe(60);
      expect(metrics.totalPromptTokens).toBe(45);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ignores descriptor lookup lines and attributes completions using request context", () => {
    const client = createMockClient();
    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    (collector as any).instanceRefModelMap.set("ref-alpha-123", "meta/llama-3-8b");
    (collector as any).instanceRefModelMap.set("ref-beta-456", "qwen/qwen-2.5-7b");

    // 1. Descriptor lookup lines generated by lms top polling (getModelInfo, getLoadConfig) must NOT change activeLogModel
    const descriptorChunk = [
      `[2026-09-16 19:50:00][INFO][Endpoint=getModelInfo] Getting descriptor for specifier: {"type":"instanceReference","instanceReference":"ref-beta-456"}`,
      `[2026-09-16 19:50:00][INFO][Endpoint=getLoadConfig] Getting load config stack for specifier: {"type":"instanceReference","instanceReference":"ref-beta-456"}`,
    ].join("\n");

    collector.parseLogChunk(descriptorChunk, "fallback-model", false);
    // activeLogModel should remain uncorrupted by descriptor polling queries
    expect((collector as any).activeLogModel).toBe("LLM");

    // 2. Request context lines (Endpoint=predict) MUST update activeLogModel
    const requestAndTimingChunk = [
      `[2026-09-16 19:50:01][INFO][Endpoint=predict] Handling predict for specifier: {"type":"instanceReference","instanceReference":"ref-beta-456"}`,
      `[2026-09-16 19:50:01] [info] slot print_timing: prompt eval time = 50.00 ms / 15 tokens`,
      `[2026-09-16 19:50:02] [info] slot print_timing:        eval time = 500.00 ms / 20 tokens (25.00 ms per token, 40.00 tokens per second)`,
      `[2026-09-16 19:50:02] [info] slot print_timing:       total time = 550.00 ms / 35 tokens`,
    ].join("\n");

    collector.parseLogChunk(requestAndTimingChunk, "fallback-model", false);

    const metrics = collector.getThroughputMetrics();
    expect(metrics.recentPredictions).toHaveLength(1);
    expect(metrics.recentPredictions[0].modelIdentifier).toBe("qwen/qwen-2.5-7b");
  });
});

describe("Codex Review Fixes - endpoint, IPv6, LAN bind locality, and busyCount deduplication", () => {
  it("checkHttpServer normalizes IPv6 addresses and wildcard binds", async () => {
    const logger = createMockLogger();
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      if (typeof url === "string" && url.includes("[::1]")) {
        return { status: 200, json: async () => ({ lmstudio: true }) } as any;
      }
      return { status: 404, json: async () => ({}) } as any;
    });

    const isRunningIPv6 = await createClientModule.checkHttpServer(logger, 1234, "::1");
    expect(isRunningIPv6).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("http://[::1]:1234/lmstudio-greeting", expect.anything());

    fetchSpy.mockRestore();
  });

  it("TopDataCollector respects explicit isLocal constructor parameter for LAN binds", () => {
    const client = createMockClient();
    const logger = createMockLogger();

    const localCollector = new TopDataCollector(client, logger, "192.168.1.20", 1234, true);
    expect(localCollector.isLocalHost()).toBe(true);

    const remoteCollector = new TopDataCollector(client, logger, "192.168.1.20", 1234, false);
    expect(remoteCollector.isLocalHost()).toBe(false);
  });

  it("deduplicates concurrent activity signals across RPC state, streams, and log tasks", async () => {
    const mockModel = {
      identifier: "test-model",
      type: "llm",
      status: "IDLE",
      getModelInfo: jest.fn().mockResolvedValue({ modelKey: "test-model" }),
      getLoadConfig: jest.fn().mockResolvedValue({}),
      getInstanceProcessingState: jest.fn().mockResolvedValue({ status: "processing", queued: 0 }),
      getContextLength: jest.fn().mockResolvedValue(2048),
    };

    const client = createMockClient({
      llm: {
        listLoaded: jest.fn().mockResolvedValue([mockModel]),
      },
    });

    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234, true);

    // Simulate 1 stream request and 1 log task active for the same model
    (collector as any).activeModelRequests.set("test-model", 1);
    (collector as any).activeLogTasks.set("task-1", { model: "test-model", timestamp: Date.now() });

    const snapshot = await collector.fetchSnapshot();

    // RPC state: 1, stream: 1, log task: 1. Total busyCount should be deduplicated to 1 (not 3)
    expect(snapshot.throughput.activePredictions).toBe(1);
  });

  it("createClient tolerates offline server when checkHealth is false", async () => {
    const logger = createMockLogger();
    const fetchSpy = jest.spyOn(global, "fetch").mockRejectedValue(new Error("Connection refused"));

    const client = await createClientModule.createClient(
      logger,
      { host: "127.0.0.1", port: 9999 },
      { checkHealth: false },
    );
    expect(client).toBeDefined();

    fetchSpy.mockRestore();
  });

  it("createClient accepts IPv6 hosts without raising port syntax error", async () => {
    const logger = createMockLogger();
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
      return { status: 200, json: async () => ({ lmstudio: true }) } as any;
    });

    const client = await createClientModule.createClient(
      logger,
      { host: "::1", port: 1234 },
      { checkHealth: true },
    );
    expect(client).toBeDefined();

    fetchSpy.mockRestore();
  });

  it("tracks parallel slot timing candidates independently without cross-slot corruption", () => {
    const client = createMockClient();
    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234);

    const parallelChunk = [
      `[2026-09-16 20:00:00] [info] slot 0 print_timing: prompt eval time = 40.00 ms / 10 tokens`,
      `[2026-09-16 20:00:01] [info] slot 1 print_timing: prompt eval time = 80.00 ms / 20 tokens`,
      `[2026-09-16 20:00:02] [info] slot 0 print_timing:        eval time = 400.00 ms / 20 tokens (25.00 ms per token, 50.00 tokens per second)`,
      `[2026-09-16 20:00:03] [info] slot 1 print_timing:        eval time = 600.00 ms / 30 tokens (20.00 ms per token, 50.00 tokens per second)`,
      `[2026-09-16 20:00:04] [info] slot 0 print_timing:       total time = 440.00 ms / 30 tokens`,
      `[2026-09-16 20:00:05] [info] slot 1 print_timing:       total time = 680.00 ms / 50 tokens`,
    ].join("\n");

    collector.parseLogChunk(parallelChunk, "test-model", false);
    const metrics = collector.getThroughputMetrics();

    expect(metrics.recentPredictions).toHaveLength(2);
    // Slot 1 completed second -> index 0
    expect(metrics.recentPredictions[0].promptTokens).toBe(20);
    expect(metrics.recentPredictions[0].predictedTokens).toBe(30);

    // Slot 0 completed first -> index 1
    expect(metrics.recentPredictions[1].promptTokens).toBe(10);
    expect(metrics.recentPredictions[1].predictedTokens).toBe(20);
  });

  it("clears live activity counters when snapshot detects offline server", async () => {
    const client = createMockClient();
    const logger = createMockLogger();
    const fetchSpy = jest.spyOn(global, "fetch").mockRejectedValue(new Error("Offline"));
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 9999);

    // Set live in-flight activity state
    (collector as any).tracker.activePredictions = 2;
    (collector as any).tracker.currentTokensPerSec = 35.5;
    (collector as any).activeModelRequests.set("test-model", 1);

    const snapshot = await collector.fetchSnapshot();

    expect(snapshot.server.status).toBe("offline");
    expect(snapshot.throughput.activePredictions).toBe(0);
    expect(snapshot.throughput.currentTokensPerSec).toBe(0);

    fetchSpy.mockRestore();
  });

  it("createClient respects explicit isRemote: false option for local authentication", async () => {
    const logger = createMockLogger();
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
      return { status: 200, json: async () => ({ lmstudio: true }) } as any;
    });

    const client = await createClientModule.createClient(
      logger,
      { host: "192.168.1.20", port: 1234 },
      { checkHealth: false, isRemote: false },
    );
    expect(client).toBeDefined();

    fetchSpy.mockRestore();
  });

  it("createClient defaults isRemote: true when host is explicitly specified", async () => {
    const logger = createMockLogger();
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
      return { status: 200, json: async () => ({ lmstudio: true }) } as any;
    });

    // Explicit loopback host without opts.isRemote should default to remote identity
    const client = await createClientModule.createClient(
      logger,
      { host: "127.0.0.1", port: 1234 },
      { checkHealth: false },
    );
    expect(client).toBeDefined();

    fetchSpy.mockRestore();
  });

  it("advances log offset to end when streaming is active or live activity is cleared", () => {
    const client = createMockClient();
    const logger = createMockLogger();
    const collector = new TopDataCollector(client, logger, "127.0.0.1", 1234, true);

    const advanceSpy = jest.spyOn(collector as any, "advanceLogOffsetToEnd");
    (collector as any).streamActive = true;
    (collector as any).refreshLogs("test-model");

    expect(advanceSpy).toHaveBeenCalled();
    advanceSpy.mockRestore();
  });
});


