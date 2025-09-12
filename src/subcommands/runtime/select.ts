import { Command } from "@commander-js/extra-typings";
import { SimpleLogger } from "@lmstudio/lms-common";
import { ModelFormatName } from "@lmstudio/lms-shared-types";
import { LMStudioClient } from "@lmstudio/sdk";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { UserInputError } from "../../types/UserInputError.js";
import { generateFullAlias } from "./helpers/AliasGenerator.js";
import { resolveLatestAlias, resolveUniqueAlias } from "./helpers/aliasResolution.js";
import { parseModelFormatNames } from "./helpers/modelFormatParsing.js";

/**
 * Selects a runtime engine by alias
 * @param logger - Logger instance for output
 * @param client - LMStudio client for API calls
 * @param alias - Engine alias to select
 * @param latest - Whether to select the latest version
 * @param modelFormats - Optional set of model format filters
 */
async function selectRuntimeEngine(
  logger: SimpleLogger,
  client: LMStudioClient,
  alias: string,
  latest: boolean,
  modelFormats?: Set<ModelFormatName>,
) {
  const engineInfos = await client.runtime.engine.list();
  const existingSelections = await client.runtime.engine.getSelections();

  const { engine: choice, fields } = latest
    ? resolveLatestAlias(engineInfos, alias, modelFormats)
    : resolveUniqueAlias(engineInfos, alias, modelFormats);

  if (latest === true) {
    if (fields.has("version")) {
      // This is to avoid user confusion where, for example, they have
      //  1. llama.cpp-metal@1.0.0
      //  2. llama.cpp-metal@1.1.0
      // Then run `lms runtime select llm-engine llama.cpp-metal@1.0.0 --latest`
      // Without this Error, the command would select @1.0.0, but that may or may not
      // be what the user intends.
      throw new UserInputError("Cannot specify a version alias with --latest.");
    }
  }

  const selectForModelFormats =
    modelFormats !== undefined
      ? new Set(
          // Filter is for safety, but choice return from alias resolutions _should_ support all
          // the supplied modelFormats.
          [...modelFormats].filter(format => choice.supportedModelFormatNames.includes(format)),
        )
      : new Set(choice.supportedModelFormatNames);

  const alreadySelectedFor = existingSelections
    .filter(existing => existing.name === choice.name && existing.version === choice.version)
    .flatMap(existing => existing.modelFormatNames);

  const formatStatus = [...selectForModelFormats].map(modelFormat => {
    return {
      modelFormat: modelFormat,
      shouldSelect: !alreadySelectedFor.includes(modelFormat),
    };
  });

  const full = generateFullAlias(choice).alias;
  for (const { modelFormat, shouldSelect } of formatStatus) {
    if (shouldSelect === true) {
      await client.runtime.engine.select(choice, modelFormat);
      logger.info("Selected " + full + " for " + modelFormat);
    } else {
      logger.info("Already selected " + full + " for " + modelFormat);
    }
  }
}

/**
 * Selects the latest versions of all currently selected runtime engines.
 * @param logger - Logger instance for output
 * @param client - LMStudio client for API calls
 * @param modelFormats - Optional set of model format filters
 */
async function selectLatestVersionOfSelectedEngines(
  logger: SimpleLogger,
  client: LMStudioClient,
  modelFormats?: Set<ModelFormatName>,
) {
  const engineInfos = await client.runtime.engine.list();
  const existingSelections = (await client.runtime.engine.getSelections())
    .flatMap(({ name, version, modelFormatNames }) => {
      return modelFormatNames.map(modelFormatName => {
        return { name, version, modelFormatName };
      });
    })
    .filter(selection => {
      if (modelFormats !== undefined) {
        return modelFormats.has(selection.modelFormatName);
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
    const full = generateFullAlias(selection).alias;
    if (selection.version !== selection.previousVersion) {
      await client.runtime.engine.select(selection, selection.modelFormatName);
      logger.info("Selected " + full + " for " + selection.modelFormatName);
    } else {
      logger.info("Already selected " + full + " for " + selection.modelFormatName);
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

    const { latest = false, for: modelFormatsJoined } = options;
    const modelFormats =
      modelFormatsJoined !== undefined ? parseModelFormatNames(modelFormatsJoined) : undefined;

    if (alias === undefined && latest === false) {
      throw new UserInputError("Must specify at least one of [alias] or --latest");
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
