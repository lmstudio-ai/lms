import { type LLMLoadModelConfig } from "@lmstudio/sdk";

export type CliSpeculativeConfig = Pick<
  LLMLoadModelConfig,
  | "speculativeDraftMtp"
  | "speculativeDraftSimple"
  | "speculativeDraftModel"
  | "speculativeDraftMaxTokens"
  | "speculativeDraftMinTokens"
  | "speculativeDraftMinContinueProbability"
> & {
  mtp?: boolean;
  drafter?: string | false;
  speculativeDraftOff?: boolean;
};

function getTuningConfig({
  speculativeDraftMaxTokens,
  speculativeDraftMinTokens,
  speculativeDraftMinContinueProbability,
}: CliSpeculativeConfig): CliSpeculativeConfig {
  return {
    ...(speculativeDraftMaxTokens !== undefined ? { speculativeDraftMaxTokens } : {}),
    ...(speculativeDraftMinTokens !== undefined ? { speculativeDraftMinTokens } : {}),
    ...(speculativeDraftMinContinueProbability !== undefined
      ? { speculativeDraftMinContinueProbability }
      : {}),
  };
}

function hasDraftTuning({
  speculativeDraftMaxTokens,
  speculativeDraftMinTokens,
  speculativeDraftMinContinueProbability,
}: CliSpeculativeConfig): boolean {
  return (
    speculativeDraftMaxTokens !== undefined ||
    speculativeDraftMinTokens !== undefined ||
    speculativeDraftMinContinueProbability !== undefined
  );
}

export function resolveCliSpeculativeDecodingLoadConfig({
  mtp,
  drafter,
  speculativeDraftMtp,
  speculativeDraftSimple,
  speculativeDraftOff,
  speculativeDraftModel,
  speculativeDraftMaxTokens,
  speculativeDraftMinTokens,
  speculativeDraftMinContinueProbability,
}: CliSpeculativeConfig): CliSpeculativeConfig {
  const config: CliSpeculativeConfig = {
    mtp,
    drafter,
    speculativeDraftMtp,
    speculativeDraftSimple,
    speculativeDraftOff,
    speculativeDraftModel,
    speculativeDraftMaxTokens,
    speculativeDraftMinTokens,
    speculativeDraftMinContinueProbability,
  };
  const tuningConfig = getTuningConfig(config);
  const draftTuning = hasDraftTuning(config);
  const explicitFullOff = drafter === false || speculativeDraftOff === true;
  const preferredDrafter = typeof drafter === "string" ? drafter : undefined;
  const legacyDrafter =
    typeof speculativeDraftModel === "string" ? speculativeDraftModel : undefined;
  const externalDrafter = preferredDrafter ?? legacyDrafter;
  const requestedBundledMtp = mtp === true || speculativeDraftMtp === true;

  if (preferredDrafter !== undefined && legacyDrafter !== undefined) {
    throw new Error("--drafter cannot be used with --speculative-draft-model.");
  }

  if (externalDrafter !== undefined && externalDrafter.length === 0) {
    throw new Error("--drafter must not be empty.");
  }

  if (explicitFullOff) {
    if (requestedBundledMtp) {
      throw new Error("--no-drafter cannot be used with --mtp.");
    }
    if (externalDrafter !== undefined) {
      throw new Error("--no-drafter cannot be used with --drafter.");
    }
    if (speculativeDraftSimple === true) {
      throw new Error("--no-drafter cannot be used with --speculative-draft-simple.");
    }
    if (draftTuning) {
      throw new Error("--no-drafter cannot be used with speculative draft tuning flags.");
    }
    return {
      speculativeDraftMtp: false,
      speculativeDraftSimple: false,
      speculativeDraftModel: false,
    };
  }

  if (mtp === true && externalDrafter !== undefined) {
    throw new Error("--mtp cannot be used with --drafter.");
  }

  if (speculativeDraftSimple === true && externalDrafter === undefined) {
    throw new Error("--speculative-draft-simple requires --drafter.");
  }

  if (draftTuning && externalDrafter === undefined && !requestedBundledMtp) {
    throw new Error("speculative draft tuning flags require --drafter or --mtp.");
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

  if (externalDrafter !== undefined) {
    return {
      speculativeDraftMtp: false,
      speculativeDraftModel: externalDrafter,
      ...tuningConfig,
    };
  }

  if (requestedBundledMtp) {
    return {
      speculativeDraftMtp: true,
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
