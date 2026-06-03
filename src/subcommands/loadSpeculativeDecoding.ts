import { type LLMLoadModelConfig } from "@lmstudio/sdk";

export interface ResolveCliSpeculativeDecodingLoadConfigOpts {
  speculativeDraftModel?: string;
  speculativeDraftMaxTokens?: number;
  speculativeDraftMinTokens?: number;
  speculativeDraftMinContinueProbability?: number;
}

export function resolveCliSpeculativeDecodingLoadConfig({
  speculativeDraftModel,
  speculativeDraftMaxTokens,
  speculativeDraftMinTokens,
  speculativeDraftMinContinueProbability,
}: ResolveCliSpeculativeDecodingLoadConfigOpts): Pick<
  LLMLoadModelConfig,
  | "speculativeDraftMtp"
  | "speculativeDraftModel"
  | "speculativeDraftMaxTokens"
  | "speculativeDraftMinTokens"
  | "speculativeDraftMinContinueProbability"
> {
  if (speculativeDraftModel === undefined) {
    if (
      speculativeDraftMaxTokens !== undefined ||
      speculativeDraftMinTokens !== undefined ||
      speculativeDraftMinContinueProbability !== undefined
    ) {
      throw new Error(
        "--speculative draft tuning flags require --speculative-draft-model.",
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
    speculativeDraftMtp: false,
    speculativeDraftModel,
    ...(speculativeDraftMaxTokens !== undefined
      ? { speculativeDraftMaxTokens: speculativeDraftMaxTokens }
      : {}),
    ...(speculativeDraftMinTokens !== undefined
      ? { speculativeDraftMinTokens: speculativeDraftMinTokens }
      : {}),
    ...(speculativeDraftMinContinueProbability !== undefined
      ? { speculativeDraftMinContinueProbability: speculativeDraftMinContinueProbability }
      : {}),
  };
}
