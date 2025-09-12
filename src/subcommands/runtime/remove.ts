import { Command } from "@commander-js/extra-typings";
import { SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import { askQuestion } from "../../confirm.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { generateFullAlias } from "./helpers/AliasGenerator.js";
import { resolveAlias } from "./helpers/aliasResolution.js";

/**
 * Removes runtime engines matching the specified alias
 * @param logger - Logger instance for output
 * @param client - LMStudio client for API calls
 * @param alias - Alias of the runtime engine(s) to remove
 * @param yes - Skip confirmation prompts if true
 * @param dryRun - Show what would be removed without executing if true
 */
async function removeRuntimeEngine(
  logger: SimpleLogger,
  client: LMStudioClient,
  alias: string,
  yes: boolean,
  dryRun: boolean,
) {
  const engineInfos = await client.runtime.engine.list();
  const { engines: choices } = resolveAlias(engineInfos, alias);
  const fullAliases = choices.map(choice => generateFullAlias(choice).alias);
  let prefix = "Will remove ";
  if (dryRun) {
    prefix = "Would remove ";
  }
  fullAliases.forEach(fullAlias => logger.info(prefix + fullAlias));
  if (dryRun) {
    return;
  }
  if (!yes) {
    const confirmed = await askQuestion(`Permanently remove?`);
    if (!confirmed) {
      logger.info("Removal cancelled.");
      return;
    }
  }
  for (const { name, version } of choices) {
    await client.runtime.engine.remove({ name, version });
    logger.info("Removed " + name + "-" + version);
  }
}

export const remove = addLogLevelOptions(
  addCreateClientOptions(
    new Command().name("remove").description("Remove installed runtime extension packs"),
  )
    .argument("<alias>", "Alias of a runtime extension pack")
    .option("-y, --yes", "Answer yes to all confirmations")
    .option("--dry-run", "Do not execute the operation")
    .action(async function (alias, options) {
      const parentOptions = this.parent?.opts() || {};
      const logger = createLogger(parentOptions);
      const client = await createClient(logger, parentOptions);

      const { yes = false, dryRun = false } = options;
      await removeRuntimeEngine(logger, client, alias, yes, dryRun);
    }),
);
