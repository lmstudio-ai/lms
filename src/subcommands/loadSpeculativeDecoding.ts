import { type LLMLoadModelConfig } from "@lmstudio/sdk";

export interface ResolveCliSpeculativeDecodingLoadConfigOpts {
  speculativeDraftMtp?: boolean;
  speculativeDraftSimple?: boolean;
  speculativeDraftModel?: string;
  speculativeDraftMaxTokens?: number;
  speculativeDraftMinTokens?: number;
  speculativeDraftMinContinueProbability?: number;
}

export function resolveCliSpeculativeDecodingLoadConfig({
  speculativeDraftMtp,
  speculativeDraftSimple,
  speculativeDraftModel,
  speculativeDraftMaxTokens,
  speculativeDraftMinTokens,
  speculativeDraftMinContinueProbability,
}: ResolveCliSpeculativeDecodingLoadConfigOpts): Pick<
  LLMLoadModelConfig,
  | "speculativeDraftMtp"
  | "speculativeDraftSimple"
  | "speculativeDraftModel"
  | "speculativeDraftMaxTokens"
  | "speculativeDraftMinTokens"
  | "speculativeDraftMinContinueProbability"
> {
  const hasDraftTuning =
    speculativeDraftMaxTokens !== undefined ||
    speculativeDraftMinTokens !== undefined ||
    speculativeDraftMinContinueProbability !== undefined;

  if (speculativeDraftMtp === true && speculativeDraftSimple === true) {
    throw new Error("--speculative-draft-mtp and --speculative-draft-simple cannot both be used.");
  }

  if (speculativeDraftModel !== undefined && speculativeDraftModel.length === 0) {
    throw new Error("--speculative-draft-model must not be empty.");
  }

  if (speculativeDraftMtp === true && speculativeDraftModel !== undefined) {
    throw new Error("--speculative-draft-mtp cannot be combined with --speculative-draft-model.");
  }

  if (speculativeDraftSimple !== true && speculativeDraftModel !== undefined) {
    throw new Error("--speculative-draft-model requires --speculative-draft-simple.");
  }

  if (speculativeDraftSimple === true && speculativeDraftModel === undefined) {
    throw new Error("--speculative-draft-simple requires --speculative-draft-model.");
  }

  if (speculativeDraftMtp !== true && speculativeDraftSimple !== true && hasDraftTuning) {
    throw new Error(
      "--speculative draft tuning flags require --speculative-draft-simple or --speculative-draft-mtp.",
    );
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

  const tuningConfig = {
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

  if (speculativeDraftMtp === undefined && speculativeDraftSimple === undefined) {
    return {};
  }

  if (speculativeDraftMtp === true) {
    return {
      speculativeDraftMtp: true,
      ...tuningConfig,
    };
  }

  if (speculativeDraftMtp === false && speculativeDraftSimple !== true) {
    return {
      speculativeDraftMtp: false,
    };
  }

  if (speculativeDraftSimple !== true) {
    return {};
  }

  return {
    speculativeDraftMtp: false,
    speculativeDraftSimple: true,
    speculativeDraftModel: speculativeDraftModel,
    ...tuningConfig,
  };
}
