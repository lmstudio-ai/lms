import { type LLMLoadModelConfig } from "@lmstudio/sdk";

export type CliSpeculativeConfig = Pick<
  LLMLoadModelConfig,
  | "speculativeDraftMtp"
  | "speculativeDraftSimple"
  | "speculativeDraftDflash"
  | "speculativeDraftDspark"
  | "speculativeDraftModel"
  | "speculativeDraftMaxTokens"
  | "speculativeDraftMinTokens"
  | "speculativeDraftMinContinueProbability"
>;

type DraftSelectorField = Extract<
  keyof CliSpeculativeConfig,
  | "speculativeDraftMtp"
  | "speculativeDraftSimple"
  | "speculativeDraftDflash"
  | "speculativeDraftDspark"
>;

const draftModeSpecs: Array<{
  flag: string;
  field: DraftSelectorField;
  requiresModel: boolean;
}> = [
  { flag: "--speculative-draft-mtp", field: "speculativeDraftMtp", requiresModel: false },
  { flag: "--speculative-draft-simple", field: "speculativeDraftSimple", requiresModel: true },
  { flag: "--speculative-draft-dflash", field: "speculativeDraftDflash", requiresModel: true },
  { flag: "--speculative-draft-dspark", field: "speculativeDraftDspark", requiresModel: true },
];

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

function buildEnabledModeConfig(
  selectedField: DraftSelectorField,
  speculativeDraftModel: string | undefined,
  tuningConfig: CliSpeculativeConfig,
): CliSpeculativeConfig {
  return {
    speculativeDraftMtp: selectedField === "speculativeDraftMtp",
    speculativeDraftSimple: selectedField === "speculativeDraftSimple",
    speculativeDraftDflash: selectedField === "speculativeDraftDflash",
    speculativeDraftDspark: selectedField === "speculativeDraftDspark",
    ...(speculativeDraftModel !== undefined ? { speculativeDraftModel } : {}),
    ...tuningConfig,
  };
}

export function resolveCliSpeculativeDecodingLoadConfig({
  speculativeDraftMtp,
  speculativeDraftSimple,
  speculativeDraftDflash,
  speculativeDraftDspark,
  speculativeDraftModel,
  speculativeDraftMaxTokens,
  speculativeDraftMinTokens,
  speculativeDraftMinContinueProbability,
}: CliSpeculativeConfig): CliSpeculativeConfig {
  const config: CliSpeculativeConfig = {
    speculativeDraftMtp,
    speculativeDraftSimple,
    speculativeDraftDflash,
    speculativeDraftDspark,
    speculativeDraftModel,
    speculativeDraftMaxTokens,
    speculativeDraftMinTokens,
    speculativeDraftMinContinueProbability,
  };
  const enabledDraftModes = draftModeSpecs.filter(({ field }) => config[field] === true);
  const hasDraftTuning =
    speculativeDraftMaxTokens !== undefined ||
    speculativeDraftMinTokens !== undefined ||
    speculativeDraftMinContinueProbability !== undefined;

  if (enabledDraftModes.length > 1) {
    throw new Error(
      `${enabledDraftModes.map(({ flag }) => flag).join(" and ")} cannot be used together.`,
    );
  }

  if (speculativeDraftModel !== undefined && speculativeDraftModel.length === 0) {
    throw new Error("--speculative-draft-model must not be empty.");
  }

  if (speculativeDraftModel !== undefined && enabledDraftModes.length === 0) {
    throw new Error(
      "--speculative-draft-model requires --speculative-draft-simple, --speculative-draft-mtp, --speculative-draft-dflash, or --speculative-draft-dspark.",
    );
  }

  const enabledMode = enabledDraftModes[0];
  if (enabledMode?.requiresModel === true && speculativeDraftModel === undefined) {
    throw new Error(`${enabledMode.flag} requires --speculative-draft-model.`);
  }

  if (enabledDraftModes.length === 0 && hasDraftTuning) {
    throw new Error(
      "--speculative draft tuning flags require --speculative-draft-simple, --speculative-draft-mtp, --speculative-draft-dflash, or --speculative-draft-dspark.",
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

  const tuningConfig = getTuningConfig(config);

  if (
    speculativeDraftMtp === undefined &&
    speculativeDraftSimple === undefined &&
    speculativeDraftDflash === undefined &&
    speculativeDraftDspark === undefined
  ) {
    return {};
  }

  if (enabledMode !== undefined) {
    return buildEnabledModeConfig(enabledMode.field, speculativeDraftModel, tuningConfig);
  }

  if (speculativeDraftMtp === false) {
    return {
      speculativeDraftMtp: false,
    };
  }

  return {};
}
