import { Command } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import { askQuestion } from "../../confirm.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { resolveMultipleRuntimeExtensions } from "./helpers/resolveRuntimeExtensions.js";

/**
 * Removes runtime engines matching the specified alias
 * @param logger - Logger instance for output
 * @param client - LMStudio client for API calls
 * @param name - Alias of the runtime engine(s) to remove
 * @param yes - Skip confirmation prompts if true
 * @param dryRun - Show what would be removed without executing if true
 */
async function removeRuntimeEngine(
  logger: SimpleLogger,
  client: LMStudioClient,
  name: string,
  yes: boolean,
  dryRun: boolean,
) {
  const engineInfos = await client.runtime.engine.list();
  const runtimeExtensions = resolveMultipleRuntimeExtensions(engineInfos, name);
  if (runtimeExtensions.length === 0) {
    logger.info("No installed runtime extensions found matching: " + name);
    logger.info();
    logger.info("Use 'lms runtime ls' to see installed runtime extensions.");
    process.exit(1);
  }
  let prefix = "About to remove ";
  if (dryRun === true) {
    prefix = "Would remove ";
  }
  for (const runtimeExtension of runtimeExtensions) {
    logger.info(prefix + `${runtimeExtension.name}@${runtimeExtension.version}`);
  }
  if (dryRun === true) {
    return;
  }
  if (!yes) {
    const confirmed = await askQuestion(`Continue?`);
    if (confirmed === false) {
      logger.info("Removal cancelled.");
      return;
    }
  }
  for (const { name, version } of runtimeExtensions) {
    await client.runtime.engine.remove({ name, version });
    logger.info("Removed " + name + "@" + version);
  }
}

export const remove = addLogLevelOptions(
  addCreateClientOptions(
    new Command().name("remove").description("Remove installed runtime extension packs"),
  )
    .argument("<name>", "Name of a runtime extension pack")
    .option("-y, --yes", "Answer yes to all confirmations")
    .option("--dry-run", "Do not execute the operation")
    .action(async function (alias, options) {
      const parentOptions = this.parent?.opts() ?? {};
      const logger = createLogger(parentOptions);
      const client = await createClient(logger, parentOptions);

      const { yes = false, dryRun = false } = options;
      await removeRuntimeEngine(logger, client, alias, yes, dryRun);
    }),
);
