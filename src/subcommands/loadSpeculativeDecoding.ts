import { type LLMLoadModelConfig } from "@lmstudio/sdk";

export interface ResolveCliSpeculativeDecodingLoadConfigOpts {
  speculativeDraftModel?: string;
  speculativeDraftMaxTokens?: number;
  speculativeDraftMinTokens?: number;
}

export function resolveCliSpeculativeDecodingLoadConfig({
  speculativeDraftModel,
  speculativeDraftMaxTokens,
  speculativeDraftMinTokens,
}: ResolveCliSpeculativeDecodingLoadConfigOpts): Pick<LLMLoadModelConfig, "speculativeDecoding"> {
  if (speculativeDraftModel === undefined) {
    if (speculativeDraftMaxTokens !== undefined || speculativeDraftMinTokens !== undefined) {
      throw new Error(
        "--speculative-draft-max-tokens and --speculative-draft-min-tokens require --speculative-draft-model.",
      );
    }

    return {};
  }

  if (speculativeDraftModel.length === 0) {
    throw new Error("--speculative-draft-model must not be empty.");
  }

  if (
    speculativeDraftMaxTokens !== undefined &&
    speculativeDraftMinTokens !== undefined &&
    speculativeDraftMinTokens > speculativeDraftMaxTokens
  ) {
    throw new Error(
      "--speculative-draft-min-tokens must be less than or equal to --speculative-draft-max-tokens.",
    );
  }

  return {
    speculativeDecoding: [
      {
        type: "draftModel",
        draftModel: speculativeDraftModel,
        ...(speculativeDraftMaxTokens !== undefined
          ? { maxTokensToDraft: speculativeDraftMaxTokens }
          : {}),
        ...(speculativeDraftMinTokens !== undefined
          ? { minDraftLengthToConsider: speculativeDraftMinTokens }
          : {}),
      },
    ],
  };
}
