import { Command } from "@commander-js/extra-typings";
import { SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import columnify from "columnify";
import { compareVersions } from "../../compareVersions.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { constructDisplayInfo } from "./common.js";

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
      logger.error(
        `No LLM Engines support the "${[...modelFormatFilters].join(", ")}" model format(s).`,
      );
      process.exit(1);
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
  .description("List LLM engines")
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
  addCreateClientOptions(new Command().name("ls").description("List installed runtimes")),
)
  .option("--full", "Show full engine aliases instead of display aliases")
  .action(async options => {
    const logger = createLogger(options);
    const client = await createClient(logger, options);
    const { full = false } = options;

    // For now, we only have engines to list
    listEngines(logger, client, undefined, full);
  })
  .addCommand(llmEngine);
