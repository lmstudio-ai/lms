import { type ModelInfo } from "@lmstudio/sdk";

export type CliListModelFilterOptions = {
  llm?: boolean;
  embedding?: boolean;
  drafter?: boolean;
};

export type CliListModel = Pick<ModelInfo, "type">;

export function filterModelsForListCommand<TModel extends CliListModel>(
  models: Array<TModel>,
  { llm = false, embedding = false, drafter = false }: CliListModelFilterOptions,
): Array<TModel> {
  if (llm === false && embedding === false && drafter === false) {
    return models;
  }

  const allowedTypes = new Set<ModelInfo["type"]>();
  if (llm) {
    allowedTypes.add("llm");
  }
  if (embedding) {
    allowedTypes.add("embedding");
  }
  if (drafter) {
    allowedTypes.add("drafter");
  }
  return models.filter(model => allowedTypes.has(model.type));
}
