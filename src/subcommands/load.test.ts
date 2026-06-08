import { resolveCliSpeculativeDecodingLoadConfig } from "./loadSpeculativeDecoding.js";

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
