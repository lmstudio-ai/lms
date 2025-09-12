import { Command } from "@commander-js/extra-typings";
import { SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { resolveAlias } from "./aliasResolution.js";

async function selectRuntimeEngine(
  logger: SimpleLogger,
  client: LMStudioClient,
  alias: string,
  latest: boolean,
  modelFormats?: Set<string>,
) {
  const engineInfos = await client.runtime.engine.list();
  const existingSelections = await client.runtime.engine.getSelections();

  const choice = resolveAlias(logger, engineInfos, alias, latest, modelFormats);
  const alreadySelectedFor = existingSelections
    .filter(existing => existing.name === choice.name && existing.version === choice.version)
    .flatMap(existing => existing.modelFormats);

  const formatStatus = [...choice.selectForModelFormats].map(modelFormat => {
    return {
      modelFormat: modelFormat,
      shouldSelect: !alreadySelectedFor.includes(modelFormat),
    };
  });

  const fullAlias = choice.name + "-" + choice.version;
  for (const { modelFormat, shouldSelect } of formatStatus) {
    if (shouldSelect) {
      await client.runtime.engine.select(choice, modelFormat);
      logger.info("Selected " + fullAlias + " for " + modelFormat);
    } else {
      logger.info("Already selected " + fullAlias + " for " + modelFormat);
    }
  }
}

async function selectLatestVersionOfSelectedEngines(
  logger: SimpleLogger,
  client: LMStudioClient,
  modelFormats?: Set<string>,
) {
  const engineInfos = await client.runtime.engine.list();
  const existingSelections = (await client.runtime.engine.getSelections())
    .flatMap(({ name, version, modelFormats }) => {
      return modelFormats.map(modelFormat => {
        return { name, version, modelFormat };
      });
    })
    .filter(selection => {
      if (modelFormats !== undefined) {
        return modelFormats.has(selection.modelFormat);
      }
      return true;
    });

  // The selections we will make
  const latestSelections = existingSelections.map(existingSelection => {
    const engineVersions = engineInfos
      .filter(engine => engine.name === existingSelection.name)
      .map(engine => engine.version)
      .sort((a, b) => compareVersions(a, b));
    return {
      ...existingSelection,
      version: engineVersions[engineVersions.length - 1],
      previousVersion: existingSelection.version,
    };
  });

  for (const selection of latestSelections) {
    const fullAlias = selection.name + "-" + selection.version;
    if (selection.version !== selection.previousVersion) {
      await client.runtime.engine.select(selection, selection.modelFormat);
      logger.info("Selected " + fullAlias + " for " + selection.modelFormat);
    } else {
      logger.info("Already selected " + fullAlias + " for " + selection.modelFormat);
    }
  }
}

const llmEngine = new Command()
  .name("llm-engine")
  .description("Select installed LLM engines")
  .argument("[alias]", "Alias of an LLM engine")
  .option("--latest", "Select the latest version")
  .option("--for <format>", "Comma-separated list of model format filters (case-insensitive)")
  .action(async function (alias, options) {
    const parentOptions = this.parent?.opts() || {};
    const logger = createLogger(parentOptions);
    const client = await createClient(logger, parentOptions);

    const { latest = false, for: modelFormatJoined } = options;
    const modelFormats = modelFormatJoined
      ? new Set(modelFormatJoined.split(",").map(s => s.toUpperCase()))
      : undefined;

    if (alias === undefined && !latest) {
      throw Error("Must specify at least one of [alias] or --latest");
    } else if (alias === undefined) {
      // latest must be true
      await selectLatestVersionOfSelectedEngines(logger, client, modelFormats);
    } else {
      // alias must be defined, latest may be true or false
      await selectRuntimeEngine(logger, client, alias, latest, modelFormats);
    }
  });

export const select = addLogLevelOptions(
  addCreateClientOptions(
    new Command().name("select").description("Select installed runtime extension pack"),
  ),
).addCommand(llmEngine);
