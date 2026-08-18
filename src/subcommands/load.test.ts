import { resolveCliSpeculativeDecodingLoadConfig } from "./loadSpeculativeDecoding.js";
import { resolveExactDrafterLoadTarget, type CliLoadTargetModel } from "./loadTargetResolution.js";

function cliModel(type: CliLoadTargetModel["type"], modelKey: string): CliLoadTargetModel {
  return { type, modelKey };
}

describe("resolveExactDrafterLoadTarget", () => {
  it("prefers exact standalone matches over exact drafter matches", () => {
    const standaloneModel = cliModel("llm", "test/main");
    const drafterModel = cliModel("drafter", "test/main");

    expect(
      resolveExactDrafterLoadTarget({
        modelKey: "test/main",
        standaloneModels: [standaloneModel],
        allDownloadedModels: [standaloneModel, drafterModel],
      }),
    ).toBeUndefined();
  });

  it("selects exact drafter matches before fuzzy standalone matching", () => {
    const fuzzyStandaloneModel = cliModel("llm", "test/main-dflash-compatible");
    const drafterModel = cliModel("drafter", "test/main-dflash");

    expect(
      resolveExactDrafterLoadTarget({
        modelKey: "test/main-dflash",
        standaloneModels: [fuzzyStandaloneModel],
        allDownloadedModels: [fuzzyStandaloneModel, drafterModel],
      }),
    ).toBe(drafterModel);
  });
});

describe("resolveCliSpeculativeDecodingLoadConfig", () => {
  it("omits speculative decoding when no speculative flags are provided", () => {
    expect(resolveCliSpeculativeDecodingLoadConfig({})).toEqual({});
  });

  it("creates inferred external drafter load config from the preferred --drafter flag", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: "test/draft",
      }),
    ).toEqual({
      speculativeDraftMtp: false,
      speculativeDraftModel: "test/draft",
    });
  });

  it("includes optional shared draft tuning settings", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: "test/draft",
        speculativeDraftMaxTokens: 7,
        speculativeDraftMinTokens: 2,
        speculativeDraftMinContinueProbability: 0.25,
      }),
    ).toEqual({
      speculativeDraftMtp: false,
      speculativeDraftModel: "test/draft",
      speculativeDraftMaxTokens: 7,
      speculativeDraftMinTokens: 2,
      speculativeDraftMinContinueProbability: 0.25,
    });
  });

  it("creates bundled Draft MTP load config from the preferred --mtp flag", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        mtp: true,
        speculativeDraftMaxTokens: 7,
      }),
    ).toEqual({
      speculativeDraftMtp: true,
      speculativeDraftMaxTokens: 7,
    });
  });

  it("keeps legacy Draft Simple syntax accepted as external drafter config", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftSimple: true,
        speculativeDraftModel: "test/draft",
      }),
    ).toEqual({
      speculativeDraftMtp: false,
      speculativeDraftModel: "test/draft",
    });
  });

  it("keeps legacy path-backed Draft MTP syntax accepted as inferred external drafter config", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMtp: true,
        speculativeDraftModel: "test/mtp-assistant",
        speculativeDraftMaxTokens: 7,
      }),
    ).toEqual({
      speculativeDraftMtp: false,
      speculativeDraftModel: "test/mtp-assistant",
      speculativeDraftMaxTokens: 7,
    });
  });

  it("keeps legacy bundled Draft MTP syntax accepted", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMtp: true,
      }),
    ).toEqual({
      speculativeDraftMtp: true,
    });
  });

  it("creates explicit Draft MTP off config from the legacy narrow off flag", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMtp: false,
      }),
    ).toEqual({
      speculativeDraftMtp: false,
    });
  });

  it("creates explicit full speculative decoding off config", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: false,
      }),
    ).toEqual({
      speculativeDraftMtp: false,
      speculativeDraftSimple: false,
      speculativeDraftModel: false,
    });

    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftOff: true,
      }),
    ).toEqual({
      speculativeDraftMtp: false,
      speculativeDraftSimple: false,
      speculativeDraftModel: false,
    });
  });

  it("rejects full speculative decoding off with active speculative decoding flags", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: false,
        mtp: true,
      }),
    ).toThrow("--no-drafter cannot be used with --mtp");

    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: false,
        speculativeDraftModel: "test/draft",
      }),
    ).toThrow("--no-drafter cannot be used with --drafter");

    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: false,
        speculativeDraftSimple: true,
      }),
    ).toThrow("--no-drafter cannot be used with --speculative-draft-simple");
  });

  it("rejects full speculative decoding off with tuning flags", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: false,
        speculativeDraftMaxTokens: 7,
      }),
    ).toThrow("--no-drafter cannot be used with speculative draft tuning flags");
  });

  it("rejects draft tuning flags without a draft source", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMaxTokens: 7,
      }),
    ).toThrow("speculative draft tuning flags require --drafter or --mtp");

    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMinContinueProbability: 0.25,
      }),
    ).toThrow("speculative draft tuning flags require --drafter or --mtp");
  });

  it("rejects an empty draft model", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: "",
      }),
    ).toThrow("--drafter must not be empty");
  });

  it("rejects legacy Draft Simple without a draft model", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftSimple: true,
      }),
    ).toThrow("--speculative-draft-simple requires --drafter");
  });

  it("rejects conflicting preferred bundled MTP and external drafter flags", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        mtp: true,
        drafter: "test/draft",
      }),
    ).toThrow("--mtp cannot be used with --drafter");
  });

  it("rejects preferred and legacy draft model aliases together", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: "test/draft",
        speculativeDraftModel: "test/legacy-draft",
      }),
    ).toThrow("--drafter cannot be used with --speculative-draft-model");
  });

  it("rejects min draft tokens greater than max draft tokens", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        drafter: "test/draft",
        speculativeDraftMaxTokens: 2,
        speculativeDraftMinTokens: 7,
      }),
    ).toThrow("--speculative-draft-min-tokens");
  });
});
