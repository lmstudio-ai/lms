import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import columnify from "columnify";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";

// Helper function to fetch, sort and display engines
async function listEngines(options: any, modelFormatFilter?: string, useFull?: boolean) {
  const logger = createLogger(options);
  const client = await createClient(logger, options);

  try {
    const resp = await client.system.unstable.getRuntimeEngines();
    const engines = resp.runtimeEngineCapabilities;

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
      // Reverse version sorting (latest first)
      return b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: "base" });
    });

    // Apply model format filter if provided
    if (modelFormatFilter) {
      sortedEngines = sortedEngines.filter(engine =>
        engine.supportedModelFormats.some(format =>
          format.toUpperCase().includes(modelFormatFilter.toUpperCase()),
        ),
      );

      if (sortedEngines.length === 0) {
        logger.error(`No LLM Engines support the "${modelFormatFilter}" model format.`);
        process.exit(1);
      }
    }

    // Format runtime data for display
    const rows = sortedEngines.map(engine => {
      const isSelected = engine.selectedForModelFormats.some(selectedFormat =>
        engine.supportedModelFormats.includes(selectedFormat),
      );

      return {
        engine: useFull ? engine.fullAlias : engine.displayAlias,
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
  } catch (error) {
    logger.error(`Failed to retrieve runtime index: ${error}`);
    process.exit(1);
  }
}

const llmEngine = new Command()
  .name("llm-engine")
  .description("List LLM engines")
  .option("--for <format>", "Filter by model format (case-insensitive)")
  .action(async function (options) {
    // Access parent options for logging and client creation
    const parentOptions = this.parent?.opts() || {};
    const combinedOptions = { ...parentOptions, ...options };

    await listEngines(combinedOptions, options.for, parentOptions["full"] === true);
  });

export const ls = addLogLevelOptions(
  addCreateClientOptions(new Command().name("ls").description("List installed runtimes")),
)
  .option("--full", "Show full engine aliases instead of display aliases")
  .action(async options => {
    // For now, we only have engines to list
    await listEngines(options, undefined, options.full);
  })
  .addCommand(llmEngine);
