import { Command } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import {
  type ModelFormatName,
  type RuntimeEngineInfo,
  type RuntimeEngineSpecifier,
  type SelectedRuntimeEngineMap,
} from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import columnify from "columnify";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { UserInputError } from "../../types/UserInputError.js";
import { AliasGroup } from "./helpers/AliasGroup.js";
import { createEngineKey, invertSelections } from "./helpers/invertSelections.js";

export interface RuntimeEngineDisplayInfo {
  specifier: RuntimeEngineSpecifier;
  minimalAlias: string;
  fullAlias: string;
  supportedModelFormatNames: ModelFormatName[];
  selectedModelFormatNames: ModelFormatName[];
}

/**
 * Resolves display alias conflicts by falling back to full aliases when duplicates exist.
 * @param capabilities - Array of runtime engine capabilities to process
 */
function resolveDuplicateMinimalAliases(capabilities: RuntimeEngineDisplayInfo[]): void {
  const aliasCounts = new Map<string, number>();
  for (const displayInfo of capabilities) {
    const current = aliasCounts.get(displayInfo.minimalAlias) ?? 0;
    aliasCounts.set(displayInfo.minimalAlias, current + 1);
  }

  // Replace duplicates with full aliases
  for (const displayInfo of capabilities) {
    const occurrences = aliasCounts.get(displayInfo.minimalAlias) ?? 0;
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
 * Constructs display information for runtime engines.
 * @param engines - Array of runtime engine info
 * @param selections - Mapping of model format names to runtime engine specifiers
 * @returns Array of runtime engine display info
 */
export function constructDisplayInfo(
  engines: RuntimeEngineInfo[],
  selections: SelectedRuntimeEngineMap,
): RuntimeEngineDisplayInfo[] {
  const groups = AliasGroup.createGroups(engines);

  const engineKey2Selections = invertSelections(selections);

  const engineDisplayInfo: RuntimeEngineDisplayInfo[] = groups
    .flatMap(group => group.getEnginesWithMinimalAliases())
    .map(({ engine, minimalAlias, fullAlias }) => ({
      specifier: engine,
      minimalAlias,
      fullAlias,
      supportedModelFormatNames: engine.supportedModelFormatNames,
      selectedModelFormatNames: engineKey2Selections.get(createEngineKey(engine)) ?? [],
    }));

  // For safety, do a final sweep of all the minimal aliases and replace any duplicates
  // with the full alias
  resolveDuplicateMinimalAliases(engineDisplayInfo);
  return engineDisplayInfo;
}

/**
 * Displays a list of runtime engines.
 * @param logger - Logger instance for output
 * @param client - LMStudio client for API calls
 * @param modelFormatFilters - Optional set of model format filters
 * @param useFull - Optional flag to use full aliases instead of minimal ones
 */
async function listEngines(
  logger: SimpleLogger,
  client: LMStudioClient,
  {
    modelFormatFilters,
    useFull = false,
  }: {
    modelFormatFilters?: Set<ModelFormatName>;
    useFull?: boolean;
  },
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
    return compareVersions(b.specifier.version, a.specifier.version);
  });

  // Apply model format filter if provided
  if (modelFormatFilters !== undefined) {
    sortedEngines = sortedEngines.filter(engine =>
      engine.supportedModelFormatNames.some(format => modelFormatFilters.has(format)),
    );

    if (sortedEngines.length === 0) {
      throw new UserInputError(
        `No LLM Engines support the "${[...modelFormatFilters].join(", ")}" model format(s).`,
      );
    }
  }

  const rows = sortedEngines.map(engine => {
    const isSelected =
      modelFormatFilters !== undefined
        ? engine.selectedModelFormatNames.some(format => modelFormatFilters.has(format))
        : engine.selectedModelFormatNames.length > 0;

    return {
      engine: useFull ? engine.fullAlias : engine.minimalAlias,
      selected: isSelected ? "✓" : "",
      format: engine.supportedModelFormatNames.join(", "),
    };
  });

  console.info(
    columnify(rows, {
      columns: ["engine", "selected", "format"],
      config: {
        engine: {
          headingTransform: () => "LLM ENGINE",
          align: "left",
        },
        selected: {
          headingTransform: () => "SELECTED",
          align: "center",
        },
        format: {
          headingTransform: () => "MODEL FORMAT",
          align: "center",
        },
      },
      preserveNewLines: true,
      columnSplitter: "    ",
    }),
  );
}

export const ls = addLogLevelOptions(
  addCreateClientOptions(
    new Command()
      .name("ls")
      .description("List installed LLM engines")
      .option("--full", "Show full aliases")
      .action(async function () {
        // Access parent options for logging and client creation
        const parentOptions = this.parent?.opts() ?? {};

        const logger = createLogger(parentOptions);
        const client = await createClient(logger, parentOptions);
        const full = this.opts()["full"] === true;

        await listEngines(logger, client, {
          useFull: full,
        });
      }),
  ),
);
