import { Command } from "@commander-js/extra-typings";
import { SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import columnify from "columnify";
import {
  RuntimeEngineInfo,
  RuntimeEngineSelectionInfo,
  RuntimeEngineSpecifier,
} from "../../../../lms-shared-types/dist/types/RuntimeEngine.js";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { UserInputError } from "../../types/UserInputError.js";
import { generateFullAlias } from "./helpers/AliasGenerator.js";
import { AliasGroup } from "./helpers/AliasGroup.js";

export interface RuntimeEngineDisplayInfo {
  specifier: RuntimeEngineSpecifier;
  minimalAlias: string;
  fullAlias: string;
  supportedModelFormats: string[];
  selectedModelFormats: string[];
}

/**
 * Resolves display alias conflicts by falling back to full aliases when duplicates exist.
 * @param capabilities - Array of runtime engine capabilities to process
 */
function resolveDuplicateMinimalAliases(capabilities: RuntimeEngineDisplayInfo[]): void {
  const aliasCounts = new Map<string, number>();
  for (const displayInfo of capabilities) {
    const current = aliasCounts.get(displayInfo.minimalAlias) || 0;
    aliasCounts.set(displayInfo.minimalAlias, current + 1);
  }

  // Replace duplicates with full aliases
  for (const displayInfo of capabilities) {
    const occurrences = aliasCounts.get(displayInfo.minimalAlias) || 0;
    if (occurrences <= 0) {
      throw new Error(
        `Expected alias '${displayInfo.minimalAlias}' to occur at least once, but found ${occurrences} occurrences.`,
      );
    } else if (occurrences >= 2) {
      console.warn(
        "Found " +
          occurrences +
          " display aliases set to " +
          displayInfo.minimalAlias +
          ". Falling back to " +
          displayInfo.fullAlias,
      );
      displayInfo.minimalAlias = displayInfo.fullAlias;
    }
  }
}

/**
 * Constructs display information for runtime engines using the new AliasGroup architecture.
 * @param engines - Array of runtime engine info
 * @param selections - Array of runtime engine selection info
 * @returns Array of runtime engine display info
 */
export function constructDisplayInfo(
  engines: RuntimeEngineInfo[],
  selections: RuntimeEngineSelectionInfo[],
): RuntimeEngineDisplayInfo[] {
  const groups = AliasGroup.createGroups(engines);

  const engineDisplayInfo: RuntimeEngineDisplayInfo[] = engines.map(engine => {
    const group = groups.find(g => g.engineType === engine.engine);

    if (!group) {
      throw new Error(
        `Engine type '${engine.engine}' not found in engine groups. This should not happen.`,
      );
    }

    const aliases = group.generateAliasesForEngine(engine);
    const minimalAlias = group.selectMinimalAlias(aliases);
    const fullAlias = generateFullAlias(engine).alias;

    return {
      specifier: engine,
      minimalAlias: minimalAlias?.alias ?? fullAlias,
      fullAlias,
      supportedModelFormats: engine.supportedModelFormats,
      selectedModelFormats: selections
        .filter(selection => selection.name === engine.name && selection.version === engine.version)
        .flatMap(selection => selection.modelFormats),
    };
  });

  // For safety, do a final sweep of all the minimal aliases and replace any duplicates
  // with the full alias
  resolveDuplicateMinimalAliases(engineDisplayInfo);
  return engineDisplayInfo;
}

async function listEngines(
  logger: SimpleLogger,
  client: LMStudioClient,
  modelFormatFilters?: Set<string>,
  useFull?: boolean,
) {
  const enginesResp = await client.runtime.engine.list();
  const selectionsResp = await client.runtime.engine.getSelections();
  const engines = constructDisplayInfo(enginesResp, selectionsResp);

  if (engines.length === 0) {
    logger.info("No runtimes found.");
    return;
  }

  // Sort by name first, then by reverse version (latest first)
  let sortedEngines = [...engines].sort((a, b) => {
    const nameCompare = a.specifier.name.localeCompare(b.specifier.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    // Reverse version sorting (latest first)
    return compareVersions(b.specifier.version, a.specifier.version);
  });

  // Apply model format filter if provided
  if (modelFormatFilters) {
    sortedEngines = sortedEngines.filter(engine =>
      engine.supportedModelFormats.some(format => modelFormatFilters.has(format.toUpperCase())),
    );

    if (sortedEngines.length === 0) {
      throw new UserInputError(
        `No LLM Engines support the "${[...modelFormatFilters].join(", ")}" model format(s).`,
      );
    }
  }

  // Format runtime data for display
  const rows = sortedEngines.map(engine => {
    const isSelected = modelFormatFilters
      ? engine.selectedModelFormats.some(format => modelFormatFilters.has(format))
      : engine.selectedModelFormats.length > 0;

    return {
      engine: useFull ? engine.fullAlias : engine.minimalAlias,
      selected: isSelected ? "✓" : "",
      format: engine.supportedModelFormats.join(", "),
    };
  });

  console.info(
    columnify(rows, {
      columns: ["engine", "selected", "format"],
      config: {
        engine: {
          headingTransform: () => chalk.grey("LLM ENGINE"),
          align: "left",
        },
        selected: {
          headingTransform: () => chalk.grey("SELECTED"),
          align: "center",
        },
        format: {
          headingTransform: () => chalk.grey("MODEL FORMAT"),
          align: "center",
        },
      },
      preserveNewLines: true,
      columnSplitter: "    ",
    }),
  );
}

const llmEngine = new Command()
  .name("llm-engine")
  .description("List installed LLM engines")
  .option("--for <format>", "Comma-separated list of model format filters (case-insensitive)")
  .action(async function (options) {
    // Access parent options for logging and client creation
    const parentOptions = this.parent?.opts() || {};
    const combinedOptions = { ...parentOptions, ...options };

    const logger = createLogger(parentOptions);
    const client = await createClient(logger, parentOptions);
    const { for: modelFormatsJoined } = options;
    const full = parentOptions["full"] === true;

    const modelFormats = modelFormatsJoined?.split(",").map(s => s.toUpperCase());

    await listEngines(logger, client, modelFormats ? new Set(modelFormats) : undefined, full);
  });

export const ls = addLogLevelOptions(
  addCreateClientOptions(
    new Command().name("ls").description("List installed runtime extension pack"),
  ),
)
  .option("--full", "Show full aliases")
  .action(async options => {
    const logger = createLogger(options);
    const client = await createClient(logger, options);
    const { full = false } = options;

    // For now, we only have engines to list
    listEngines(logger, client, undefined, full);
  })
  .addCommand(llmEngine);
