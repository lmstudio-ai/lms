import { Command } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import {
  type LMStudioClient,
  type ModelFormatName,
  type RuntimeEngineInfo,
  type SelectedRuntimeEngineMap,
} from "@lmstudio/sdk";
import columnify from "columnify";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { UserInputError } from "../../types/UserInputError.js";
import { invertSelections } from "./helpers/invertSelections.js";

interface RuntimeEngineDisplayInfo {
  name: string;
  version: string;
  supportedModelFormatNames: ModelFormatName[];
  selectedModelFormatNames: ModelFormatName[];
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
  const selectionReverseLookup = invertSelections(selections);
  const engineDisplayInfo: RuntimeEngineDisplayInfo[] = engines.map(
    ({ name, version, supportedModelFormatNames }) => ({
      name,
      version,
      supportedModelFormatNames,
      selectedModelFormatNames: selectionReverseLookup.get(`${name}:${version}`) ?? [],
    }),
  );
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
  }: {
    modelFormatFilters?: Set<ModelFormatName>;
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
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return compareVersions(b.version, a.version);
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
      engine: `${engine.name}@${engine.version}`,
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

const lsCommand = new Command()
  .name("ls")
  .description("List installed LLM engines")
  .action(async function () {
    // Access options for logging and client creation
    const options = this.optsWithGlobals();
    const logger = createLogger(options);
    await using client = await createClient(logger, options);

    await listEngines(logger, client, {});
  });

addCreateClientOptions(lsCommand);
addLogLevelOptions(lsCommand);

export const ls = lsCommand;
