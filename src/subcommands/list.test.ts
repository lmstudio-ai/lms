import { filterModelsForListCommand, type CliListModel } from "./listModelFilters.js";

function cliListModel(type: CliListModel["type"]): CliListModel {
  return { type };
}

describe("filterModelsForListCommand", () => {
  it("returns all model types without domain filters", () => {
    const models = [cliListModel("llm"), cliListModel("embedding"), cliListModel("drafter")];

    expect(filterModelsForListCommand(models, {})).toEqual(models);
  });

  it("filters to drafters for lms ls --drafter", () => {
    const drafterModel = cliListModel("drafter");

    expect(
      filterModelsForListCommand([cliListModel("llm"), cliListModel("embedding"), drafterModel], {
        drafter: true,
      }),
    ).toEqual([drafterModel]);
  });

  it("combines drafter with other domain filters", () => {
    const llmModel = cliListModel("llm");
    const drafterModel = cliListModel("drafter");

    expect(
      filterModelsForListCommand([llmModel, cliListModel("embedding"), drafterModel], {
        llm: true,
        drafter: true,
      }),
    ).toEqual([llmModel, drafterModel]);
  });
});
