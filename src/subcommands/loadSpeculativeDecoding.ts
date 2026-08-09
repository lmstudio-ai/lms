import { type LLMLoadModelConfig } from "@lmstudio/sdk";

export interface ResolveCliSpeculativeDecodingLoadConfigOpts {
  speculativeDraftMtp?: boolean;
  speculativeDraftSimple?: boolean;
  speculativeDraftDflash?: boolean;
  speculativeDraftModel?: string;
  speculativeDraftMaxTokens?: number;
  speculativeDraftMinTokens?: number;
  speculativeDraftMinContinueProbability?: number;
}

export function resolveCliSpeculativeDecodingLoadConfig({
  speculativeDraftMtp,
  speculativeDraftSimple,
  speculativeDraftDflash,
  speculativeDraftModel,
  speculativeDraftMaxTokens,
  speculativeDraftMinTokens,
  speculativeDraftMinContinueProbability,
}: ResolveCliSpeculativeDecodingLoadConfigOpts): Pick<
  LLMLoadModelConfig,
  | "speculativeDraftMtp"
  | "speculativeDraftSimple"
  | "speculativeDraftDflash"
  | "speculativeDraftModel"
  | "speculativeDraftMaxTokens"
  | "speculativeDraftMinTokens"
  | "speculativeDraftMinContinueProbability"
> {
  const enabledDraftModes = [
    speculativeDraftMtp === true ? "--speculative-draft-mtp" : undefined,
    speculativeDraftSimple === true ? "--speculative-draft-simple" : undefined,
    speculativeDraftDflash === true ? "--speculative-draft-dflash" : undefined,
  ].filter(mode => mode !== undefined);
  const hasDraftTuning =
    speculativeDraftMaxTokens !== undefined ||
    speculativeDraftMinTokens !== undefined ||
    speculativeDraftMinContinueProbability !== undefined;

  if (enabledDraftModes.length > 1) {
    throw new Error(`${enabledDraftModes.join(" and ")} cannot be used together.`);
  }

  if (speculativeDraftModel !== undefined && speculativeDraftModel.length === 0) {
    throw new Error("--speculative-draft-model must not be empty.");
  }

  if (speculativeDraftModel !== undefined && enabledDraftModes.length === 0) {
    throw new Error(
      "--speculative-draft-model requires --speculative-draft-simple, --speculative-draft-mtp, or --speculative-draft-dflash.",
    );
  }

  if (speculativeDraftSimple === true && speculativeDraftModel === undefined) {
    throw new Error("--speculative-draft-simple requires --speculative-draft-model.");
  }

  if (speculativeDraftDflash === true && speculativeDraftModel === undefined) {
    throw new Error("--speculative-draft-dflash requires --speculative-draft-model.");
  }

  if (enabledDraftModes.length === 0 && hasDraftTuning) {
    throw new Error(
      "--speculative draft tuning flags require --speculative-draft-simple, --speculative-draft-mtp, or --speculative-draft-dflash.",
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

  if (
    speculativeDraftMtp === undefined &&
    speculativeDraftSimple === undefined &&
    speculativeDraftDflash === undefined
  ) {
    return {};
  }

  if (speculativeDraftMtp === true) {
    return {
      speculativeDraftMtp: true,
      ...(speculativeDraftModel !== undefined ? { speculativeDraftModel } : {}),
      ...tuningConfig,
    };
  }

  if (speculativeDraftSimple === true) {
    return {
      speculativeDraftMtp: false,
      speculativeDraftSimple: true,
      speculativeDraftModel,
      ...tuningConfig,
    };
  }

  if (speculativeDraftDflash === true) {
    return {
      speculativeDraftMtp: false,
      speculativeDraftDflash: true,
      speculativeDraftModel,
      ...tuningConfig,
    };
  }

  if (speculativeDraftMtp === false) {
    return {
      speculativeDraftMtp: false,
    };
  }

  return {};
}
