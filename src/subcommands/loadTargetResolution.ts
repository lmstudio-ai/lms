import { type ModelInfo } from "@lmstudio/sdk";

export type CliLoadTargetModel = Pick<ModelInfo, "type" | "modelKey">;

export function resolveExactDrafterLoadTarget<TModel extends CliLoadTargetModel>({
  modelKey,
  standaloneModels,
  allDownloadedModels,
}: {
  modelKey: string | undefined;
  standaloneModels: Array<TModel>;
  allDownloadedModels: Array<TModel>;
}): TModel | undefined {
  const normalizedModelKey = modelKey?.toLowerCase();
  if (normalizedModelKey === undefined) {
    return undefined;
  }

  const exactStandaloneModel = standaloneModels.find(
    model => model.modelKey.toLowerCase() === normalizedModelKey,
  );
  if (exactStandaloneModel !== undefined) {
    return undefined;
  }

  return allDownloadedModels.find(
    model => model.type === "drafter" && model.modelKey.toLowerCase() === normalizedModelKey,
  );
}
