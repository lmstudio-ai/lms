import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient, type ModelInfo } from "@lmstudio/sdk";
import {
  assertLoadConfigSupportedForCliModel,
  load,
  resolveDownloadedModelVariant,
} from "./load.js";
import { resolveCliSpeculativeDecodingLoadConfig } from "./loadSpeculativeDecoding.js";

jest.mock("@inquirer/prompts", () => ({ search: jest.fn() }));

describe("assertLoadConfigSupportedForCliModel", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects AutoFit for embedding models", () => {
    const logger = { errorWithoutPrefix: jest.fn() } as unknown as SimpleLogger;
    jest.spyOn(process, "exit").mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });

    expect(() =>
      assertLoadConfigSupportedForCliModel({
        model: { type: "embedding" },
        loadConfig: { autoFit: true },
        logger,
      }),
    ).toThrow("process.exit(1)");
    expect(logger.errorWithoutPrefix).toHaveBeenCalledWith(
      expect.stringContaining("AutoFit can only be configured for LLM models."),
    );
  });
});

describe("resolveDownloadedModelVariant", () => {
  const baseModel = { modelKey: "google/gemma-4-26b-a4b", deviceIdentifier: null } as ModelInfo;
  const variantModel = {
    modelKey: "google/gemma-4-26b-a4b@4bit",
    deviceIdentifier: null,
  } as ModelInfo;

  it("resolves an exact variant key emitted by lms ls --variants", async () => {
    const listDownloadedModelVariants = jest.fn().mockResolvedValue([variantModel]);
    const client = {
      system: { listDownloadedModelVariants },
    } as unknown as LMStudioClient;

    await expect(
      resolveDownloadedModelVariant({
        client,
        modelKey: variantModel.modelKey,
        models: [baseModel],
      }),
    ).resolves.toBe(variantModel);
    expect(listDownloadedModelVariants).toHaveBeenCalledWith(baseModel.modelKey);
  });

  it("does not query variants for a base model key", async () => {
    const listDownloadedModelVariants = jest.fn();
    const client = {
      system: { listDownloadedModelVariants },
    } as unknown as LMStudioClient;

    await expect(
      resolveDownloadedModelVariant({
        client,
        modelKey: baseModel.modelKey,
        models: [baseModel],
      }),
    ).resolves.toBeUndefined();
    expect(listDownloadedModelVariants).not.toHaveBeenCalled();
  });

  it("returns undefined when the variant is not downloaded", async () => {
    const client = {
      system: { listDownloadedModelVariants: jest.fn().mockResolvedValue([baseModel]) },
    } as unknown as LMStudioClient;

    await expect(
      resolveDownloadedModelVariant({
        client,
        modelKey: "google/gemma-4-26b-a4b@q4_k_m",
        models: [baseModel],
      }),
    ).resolves.toBeUndefined();
  });

  it("does not resolve a variant hosted only on a linked device", async () => {
    const remoteVariant = {
      modelKey: variantModel.modelKey,
      deviceIdentifier: "linked-device",
    } as ModelInfo;
    const client = {
      system: { listDownloadedModelVariants: jest.fn().mockResolvedValue([remoteVariant]) },
    } as unknown as LMStudioClient;

    await expect(
      resolveDownloadedModelVariant({
        client,
        modelKey: variantModel.modelKey,
        models: [baseModel],
      }),
    ).resolves.toBeUndefined();
  });

  it("prefers a matching variant on an eligible device", async () => {
    const remoteVariant = {
      modelKey: variantModel.modelKey,
      deviceIdentifier: "linked-device",
    } as ModelInfo;
    const client = {
      system: {
        listDownloadedModelVariants: jest.fn().mockResolvedValue([remoteVariant, variantModel]),
      },
    } as unknown as LMStudioClient;

    await expect(
      resolveDownloadedModelVariant({
        client,
        modelKey: variantModel.modelKey,
        models: [baseModel],
      }),
    ).resolves.toBe(variantModel);
  });
});

describe("load command", () => {
  it.each([
    { arguments: ["--gpu", "max"], option: "--gpu <offload-ratio>" },
    { arguments: ["--context-length", "4096"], option: "-c, --context-length <length>" },
  ])("rejects AutoFit with $option", async ({ arguments: manualArguments, option }) => {
    load.exitOverride();
    load.configureOutput({ writeErr: () => {} });

    await expect(
      load.parseAsync(["node", "lms", "test-model", "--auto", ...manualArguments]),
    ).rejects.toThrow(`cannot be used with option '${option}'`);
  });
});

describe("resolveCliSpeculativeDecodingLoadConfig", () => {
  it("omits speculative decoding when no speculative flags are provided", () => {
    expect(resolveCliSpeculativeDecodingLoadConfig({})).toEqual({});
  });

  it("creates flat draft-model load config", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftSimple: true,
        speculativeDraftModel: "test/draft",
      }),
    ).toEqual({
      speculativeDraftMtp: false,
      speculativeDraftSimple: true,
      speculativeDraftModel: "test/draft",
    });
  });

  it("includes optional shared draft tuning settings", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftSimple: true,
        speculativeDraftModel: "test/draft",
        speculativeDraftMaxTokens: 7,
        speculativeDraftMinTokens: 2,
        speculativeDraftMinContinueProbability: 0.25,
      }),
    ).toEqual({
      speculativeDraftMtp: false,
      speculativeDraftSimple: true,
      speculativeDraftModel: "test/draft",
      speculativeDraftMaxTokens: 7,
      speculativeDraftMinTokens: 2,
      speculativeDraftMinContinueProbability: 0.25,
    });
  });

  it("creates Draft MTP load config", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMtp: true,
        speculativeDraftMaxTokens: 7,
      }),
    ).toEqual({
      speculativeDraftMtp: true,
      speculativeDraftMaxTokens: 7,
    });
  });

  it("creates explicit Draft MTP off config", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMtp: false,
      }),
    ).toEqual({
      speculativeDraftMtp: false,
    });
  });

  it("rejects draft tuning flags without a draft type", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMaxTokens: 7,
      }),
    ).toThrow("--speculative-draft-simple or --speculative-draft-mtp");

    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMinContinueProbability: 0.25,
      }),
    ).toThrow("--speculative-draft-simple or --speculative-draft-mtp");
  });

  it("rejects draft model without Draft Simple", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftModel: "test/draft",
      }),
    ).toThrow("--speculative-draft-model requires --speculative-draft-simple");
  });

  it("rejects Draft Simple without a draft model", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftSimple: true,
      }),
    ).toThrow("--speculative-draft-simple requires --speculative-draft-model");
  });

  it("rejects Draft MTP with Draft Simple", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMtp: true,
        speculativeDraftSimple: true,
        speculativeDraftModel: "test/draft",
      }),
    ).toThrow("--speculative-draft-mtp and --speculative-draft-simple");
  });

  it("rejects Draft MTP with a draft model resource", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMtp: true,
        speculativeDraftModel: "test/draft",
      }),
    ).toThrow("--speculative-draft-mtp cannot be combined with --speculative-draft-model");
  });

  it("rejects min draft tokens greater than max draft tokens", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftSimple: true,
        speculativeDraftModel: "test/draft",
        speculativeDraftMaxTokens: 2,
        speculativeDraftMinTokens: 7,
      }),
    ).toThrow("--speculative-draft-min-tokens");
  });
});
