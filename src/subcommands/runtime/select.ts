import { Command } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { type ModelFormatName } from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { UserInputError } from "../../types/UserInputError.js";
import { findLatestVersion } from "./helpers/findLatestVersion.js";
import {
  doesSpecifierStringSpecifyVersion,
  resolveMultipleRuntimeExtensions,
} from "./helpers/resolveRuntimeExtensions.js";

/**
 * Selects a runtime engine by alias
 * @param logger - Logger instance for output
 * @param client - LMStudio client for API calls
 * @param name - Engine alias to select
 * @param latest - Whether to select the latest version
 * @param modelFormats - Optional set of model format filters
 */
async function selectRuntimeEngine(
  logger: SimpleLogger,
  client: LMStudioClient,
  name: string,
  latest: boolean,
) {
  const engineInfos = await client.runtime.engine.list();

  if (latest && doesSpecifierStringSpecifyVersion(name)) {
    // This is to avoid user confusion where, for example, they have
    //  1. llama.cpp-win-x86_64-avx2@1.0.0
    //  2. llama.cpp-win-x86_64-avx2@1.1.0
    // Then run `lms runtime select llm-engine llama.cpp-win-x86_64-avx2@1.0.0 --latest`
    // Without this Error, the command would select @1.0.0, but that may or may not
    // be what the user intends.
    throw new UserInputError("Cannot specify version with --latest.");
  }

  let runtimeExtensions = resolveMultipleRuntimeExtensions(engineInfos, name);

  if (latest) {
    // Filter to only the latest version
    const latestVersion = findLatestVersion(runtimeExtensions);
    if (latestVersion === null) {
      runtimeExtensions = [];
    } else {
      runtimeExtensions = [latestVersion];
    }
  }

  if (runtimeExtensions.length === 0) {
    logger.info("No installed runtime extensions found matching: " + name);
    logger.info();
    logger.info("Use 'lms runtime ls' to see installed runtime extensions.");
    process.exit(1);
  }

  if (runtimeExtensions.length > 1) {
    logger.info("Multiple runtime extensions found:");
    logger.info();
    for (const runtimeExtension of runtimeExtensions) {
      logger.info(`  - ${runtimeExtension.name}@${runtimeExtension.version}`);
    }
    logger.info();
    logger.info("Please disambiguate by specifying a version.");
    process.exit(1);
  }

  const runtimeExtension = runtimeExtensions[0];
  const supportedModelFormatNames = runtimeExtension.supportedModelFormatNames;
  const selections = await client.runtime.engine.getSelections();

  for (const modelFormatName of supportedModelFormatNames) {
    const existingSelection = selections.get(modelFormatName);
    if (
      existingSelection === undefined ||
      existingSelection.name !== runtimeExtension.name ||
      existingSelection.version !== runtimeExtension.version
    ) {
      await client.runtime.engine.select(runtimeExtension, modelFormatName);
      logger.infoText`
        Selected ${runtimeExtension.name}@${runtimeExtension.version} for ${modelFormatName}
      `;
    } else {
      logger.infoText`
        Already selected ${runtimeExtension.name}@${runtimeExtension.version}
        for ${modelFormatName}
      `;
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
  const existingSelections = [...(await client.runtime.engine.getSelections())]
    .map(([key, value]) => {
      return { modelFormatName: key, ...value };
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
    if (selection.version !== selection.previousVersion) {
      await client.runtime.engine.select(selection, selection.modelFormatName);
      logger.infoText`
        Selected ${selection.name}@${selection.version} for ${selection.modelFormatName}
      `;
    } else {
      logger.infoText`
        Already selected ${selection.name}@${selection.version} for ${selection.modelFormatName}
      `;
    }
  }
}

const selectCommand = new Command()
  .name("select")
  .description("Select installed LLM engines")
  .argument("[alias]", "Alias of an LLM engine")
  .option("--latest", "Select the latest version")
  .action(async function (alias) {
    const mergedOptions = this.optsWithGlobals();
    const logger = createLogger(mergedOptions as LogLevelArgs);
    await using client = await createClient(
      logger,
      mergedOptions as CreateClientArgs & LogLevelArgs,
    );

    const { latest = false } = mergedOptions;

    if (alias === undefined && latest === false) {
      throw new UserInputError("Must specify at least one of [alias] or --latest");
    } else if (alias === undefined) {
      await selectLatestVersionOfSelectedEngines(logger, client);
    } else {
      await selectRuntimeEngine(logger, client, alias, latest);
    }
  });

addCreateClientOptions(selectCommand);
addLogLevelOptions(selectCommand);

export const select = selectCommand;
