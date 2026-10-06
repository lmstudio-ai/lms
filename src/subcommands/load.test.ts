import { type SimpleLogger } from "@lmstudio/lms-common";
import { getCliPref } from "../cliPref.js";
import { createClient } from "../createClient.js";
import type * as CreateClientModule from "../createClient.js";
import { createDeviceNameResolver } from "../deviceNameLookup.js";
import { assertLoadConfigSupportedForCliModel, load } from "./load.js";
import { resolveCliSpeculativeDecodingLoadConfig } from "./loadSpeculativeDecoding.js";

jest.mock("@inquirer/prompts", () => ({ search: jest.fn() }));
jest.mock("../createClient.js", () => ({
  ...jest.requireActual<typeof CreateClientModule>("../createClient.js"),
  createClient: jest.fn(),
}));
jest.mock("../cliPref.js", () => ({ getCliPref: jest.fn() }));
jest.mock("../deviceNameLookup.js", () => ({ createDeviceNameResolver: jest.fn() }));
jest.mock("../Spinner.js", () => ({
  Spinner: class {
    setText() {}
    stop() {}
    stopIfNotStopped() {}
  },
}));

describe("assertLoadConfigSupportedForCliModel", () => {
  it("allows decision lifecycle load controls", () => {
    const logger = { errorWithoutPrefix: jest.fn() } as unknown as SimpleLogger;
    assertLoadConfigSupportedForCliModel({
      model: { type: "decision" },
      loadConfig: { autoFit: true, maxParallelPredictions: 2 },
      logger,
    });
    expect(logger.errorWithoutPrefix).not.toHaveBeenCalled();
  });

  it.each([{ engineCwd: "." }, { engineConfigFileContents: "" }, { speculativeDraftMtp: false }])(
    "rejects LLM-only settings for decision models: %j",
    loadConfig => {
      const logger = { errorWithoutPrefix: jest.fn() } as unknown as SimpleLogger;
      jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      expect(() =>
        assertLoadConfigSupportedForCliModel({ model: { type: "decision" }, loadConfig, logger }),
      ).toThrow("exit");
      expect(logger.errorWithoutPrefix).toHaveBeenCalledWith(
        expect.stringContaining("can only be configured for LLM models"),
      );
    },
  );

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
      expect.stringContaining("AutoFit cannot be configured for embedding models."),
    );
  });
});

describe("load command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const option of load.options) {
      load.setOptionValue(option.attributeName(), option.defaultValue);
    }
    jest.mocked(getCliPref).mockResolvedValue({
      get: () => ({ lastLoadedModels: [] }),
      setWithProducer: jest.fn(),
    } as unknown as Awaited<ReturnType<typeof getCliPref>>);
    jest.mocked(createDeviceNameResolver).mockResolvedValue({
      isLocal: (deviceIdentifier: string | null) => deviceIdentifier === null,
      label: () => "Test peer",
    } as unknown as Awaited<ReturnType<typeof createDeviceNameResolver>>);
  });

  it.each(["llm", "embedding", "decision"] as const)(
    "routes loading and estimation through the %s namespace",
    async type => {
      const info = { type, modelKey: "test/model", path: "test/model", deviceIdentifier: "peer" };
      const namespaces = Object.fromEntries(
        ["llm", "embedding", "decision"].map(
          name =>
            [
              name,
              {
                load: jest.fn(async () => ({
                  getModelInfo: async () => ({ ...info, identifier: "instance" }),
                })),
                estimateResourcesUsage: jest.fn(async () => ({
                  memory: { totalVramBytes: 1024, totalBytes: 2048, confidence: "high" },
                  passesGuardrails: true,
                })),
              },
            ] as const,
        ),
      );
      jest.mocked(createClient).mockResolvedValue({
        [Symbol.asyncDispose]: async () => {},
        system: { listDownloadedModels: async () => [info] },
        ...namespaces,
      } as unknown as Awaited<ReturnType<typeof createClient>>);

      for (const selection of [
        ["--exact", info.path],
        [info.modelKey, "--yes"],
      ]) {
        for (const option of load.options) {
          load.setOptionValue(option.attributeName(), option.defaultValue);
        }
        await load.parseAsync(["node", "lms", "--quiet", ...selection]);
        await load.parseAsync(["node", "lms", "--quiet", ...selection, "--estimate-only"]);
      }
      expect(namespaces[type].load).toHaveBeenCalledTimes(2);
      expect(namespaces[type].load).toHaveBeenCalledWith(
        info.modelKey,
        expect.objectContaining({
          deviceIdentifier: "peer",
        }),
      );
      expect(namespaces[type].estimateResourcesUsage).toHaveBeenCalledTimes(2);
      expect(namespaces[type].estimateResourcesUsage).toHaveBeenCalledWith(
        info.modelKey,
        expect.any(Object),
        { deviceIdentifier: "peer" },
      );
      for (const [name, namespace] of Object.entries(namespaces)) {
        if (name !== type) {
          expect(namespace.load).not.toHaveBeenCalled();
          expect(namespace.estimateResourcesUsage).not.toHaveBeenCalled();
        }
      }
    },
  );

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
