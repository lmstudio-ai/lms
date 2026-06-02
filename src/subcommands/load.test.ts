import { resolveCliSpeculativeDecodingLoadConfig } from "./loadSpeculativeDecoding.js";

describe("resolveCliSpeculativeDecodingLoadConfig", () => {
  it("omits speculative decoding when no speculative flags are provided", () => {
    expect(resolveCliSpeculativeDecodingLoadConfig({})).toEqual({});
  });

  it("creates a canonical draftModel strategy", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftModel: "test/draft",
      }),
    ).toEqual({
      speculativeDecoding: [
        {
          type: "draftModel",
          draftModel: "test/draft",
        },
      ],
    });
  });

  it("includes optional max and min draft token settings", () => {
    expect(
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftModel: "test/draft",
        speculativeDraftMaxTokens: 7,
        speculativeDraftMinTokens: 2,
      }),
    ).toEqual({
      speculativeDecoding: [
        {
          type: "draftModel",
          draftModel: "test/draft",
          maxTokensToDraft: 7,
          minDraftLengthToConsider: 2,
        },
      ],
    });
  });

  it("rejects draft token flags without a draft model", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftMaxTokens: 7,
      }),
    ).toThrow("--speculative-draft-model");
  });

  it("rejects min draft tokens greater than max draft tokens", () => {
    expect(() =>
      resolveCliSpeculativeDecodingLoadConfig({
        speculativeDraftModel: "test/draft",
        speculativeDraftMaxTokens: 2,
        speculativeDraftMinTokens: 7,
      }),
    ).toThrow("--speculative-draft-min-tokens");
  });
});
