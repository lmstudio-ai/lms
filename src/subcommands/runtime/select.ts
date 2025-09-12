import { Command } from "@commander-js/extra-typings";
import { SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import { RuntimeEngineInfo } from "../../../../lms-shared-types/dist/types/RuntimeEngine.js";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { AliasField, fallbackAlias, generateAliases } from "./common.js";

function generateAliasMap(engines: RuntimeEngineInfo[]): Map<
  string,
  {
    engines: {
      name: string;
      version: string;
      supportedModelFormats: Set<string>;
    }[];
    fields: Set<AliasField>;
  }
> {
  const enginesAndAliases = engines.map(engine => {
    return {
      engine: {
        name: engine.name,
        version: engine.version,
        engine,
      },
      builtAliases: generateAliases(engine),
    };
  });
  // generateAliases does not include fallback aliases in its map, but we want to enable
  // CLI users to select via a fallback alias as well.
  enginesAndAliases.forEach(engineAndAliases =>
    engineAndAliases.builtAliases.push(fallbackAlias(engineAndAliases.engine)),
  );

  const aliasMap = new Map<
    string,
    {
      engines: {
        name: string;
        version: string;
        supportedModelFormats: Set<string>;
      }[];
      fields: Set<AliasField>;
    }
  >();

  const setsEqual = (set1: Set<AliasField>, set2: Set<AliasField>): boolean => {
    return set1.size === set2.size && [...set1].every(item => set2.has(item));
  };

  for (const { engine, builtAliases } of enginesAndAliases) {
    const supportedModelFormats = new Set(engine.engine.supportedModelFormats);
    for (const builtAlias of builtAliases) {
      const { alias, fields } = builtAlias;

      if (aliasMap.has(alias)) {
        const existingEntry = aliasMap.get(alias)!;

        if (!setsEqual(existingEntry.fields, fields)) {
          throw Error(
            `Component conflict for alias "${alias}": ` +
              `existing components [${Array.from(existingEntry.fields).join(", ")}] ` +
              `differ from new components [${Array.from(fields).join(", ")}]`,
          );
        }

        existingEntry.engines.push({ ...engine, supportedModelFormats });
      } else {
        aliasMap.set(alias, {
          engines: [{ ...engine, supportedModelFormats }],
          fields: new Set(fields),
        });
      }
    }
  }

  return aliasMap;
}

function resolveAlias(
  logger: SimpleLogger,
  engineInfos: RuntimeEngineInfo[],
  alias: string,
  latest: boolean,
  modelFormats: Set<string> | undefined,
): {
  name: string;
  version: string;
  selectForModelFormats: Set<string>;
} {
  const map = generateAliasMap(engineInfos);
  const elem = map.get(alias);
  if (elem === undefined) {
    throw Error("Alias not found: " + alias);
  }
  let engines: {
    name: string;
    version: string;
    selectForModelFormats: Set<string>;
  }[];
  const { engines: prelimEngines, fields } = elem;

  // Apply passed in model formats. An engine must be compatible with _all_ requested formats
  // to be a selection candidate. We track selectForModelFormats to ensure we only select
  // for requested formats
  if (modelFormats !== undefined) {
    engines = prelimEngines
      .filter(e => {
        return [...modelFormats].every(format => e.supportedModelFormats.has(format));
      })
      .map(e => {
        return { name: e.name, version: e.version, selectForModelFormats: modelFormats };
      });
    if (engines.length === 0) {
      throw Error(
        "Alias '" +
          alias +
          "' does not match any engines that are compatible with model format(s) [" +
          [...modelFormats].join(",") +
          "].",
      );
    }
  } else {
    engines = prelimEngines.map(e => {
      return { name: e.name, version: e.version, selectForModelFormats: e.supportedModelFormats };
    });
  }

  if (fields.has("version")) {
    if (latest) {
      throw Error("Versioned alias and latest are mutually exclusive.");
    }
    if (engines.length > 1) {
      throw Error(
        "Alias '" +
          alias +
          "' is ambiguous. Options are [" +
          engines.map(e => fallbackAlias(e).alias) +
          "].",
      );
    }
    return engines[0];
  } else {
    const engineNames = new Set([...engines].map(e => e.name));
    if (engineNames.size > 1) {
      throw Error(
        "Latest alias '" +
          alias +
          "' cannot disambiguate between engine names [" +
          [...engineNames].join(",") +
          "].",
      );
    }
    if (latest) {
      const sortedEngines = [...engines].sort((a, b) => compareVersions(a.version, b.version));
      return sortedEngines[sortedEngines.length - 1];
    } else if (engines.length === 1) {
      return engines[0];
    } else {
      throw Error(
        "Alias '" +
          alias +
          "' is ambiguous. Options are [" +
          engines.map(e => fallbackAlias(e).alias) +
          "].",
      );
    }
  }
}

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
  formatStatus.forEach(({ modelFormat, shouldSelect }) => {
    if (shouldSelect) {
      client.runtime.engine.select({ engine: choice, modelFormat });
      logger.info("Selected " + fullAlias + " for " + modelFormat);
    } else {
      logger.info("Already selected " + fullAlias + " for " + modelFormat);
    }
  });
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

  latestSelections.forEach(selection => {
    const fullAlias = selection.name + "-" + selection.version;
    if (selection.version !== selection.previousVersion) {
      client.runtime.engine.select({
        engine: { name: selection.name, version: selection.version },
        modelFormat: selection.modelFormat,
      });
      logger.info("Selected " + fullAlias + " for " + selection.modelFormat);
    } else {
      logger.info("Already selected " + fullAlias + " for " + selection.modelFormat);
    }
  });
}

const llmEngine = new Command()
  .name("llm-engine")
  .description("List LLM engines")
  .argument("[alias]", "Alias of a runtime")
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
      selectLatestVersionOfSelectedEngines(logger, client, modelFormats);
    } else {
      // alias must be defined, latest may be true or false
      selectRuntimeEngine(logger, client, alias, latest, modelFormats);
    }
  });

export const select = addLogLevelOptions(
  addCreateClientOptions(new Command().name("select").description("List installed runtimes")),
).addCommand(llmEngine);
