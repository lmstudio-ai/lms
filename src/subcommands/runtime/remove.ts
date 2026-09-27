import { Command } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import { askQuestion } from "../../confirm.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../../createClient.js";
import { t } from "../../i18n/index.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
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
    logger.info(t("No installed runtime extensions found matching: " + name));
    logger.info();
    logger.info(t("Use 'lms runtime ls' to see installed runtime extensions."));
    process.exit(1);
  }
  let prefix = t("About to remove ");
  if (dryRun === true) {
    prefix = t("Would remove ");
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
      logger.info(t("Removal cancelled."));
      return;
    }
  }
  for (const { name, version } of runtimeExtensions) {
    await client.runtime.engine.remove({ name, version });
    logger.info(t("Removed ") + name + "@" + version);
  }
}

const removeCommand = new Command()
  .name("remove")
  .description(t("Remove installed runtime extension packs"));

addCreateClientOptions(removeCommand);
addLogLevelOptions(removeCommand);

removeCommand
  .argument("<name>", t("Name of a runtime extension pack"))
  .option("-y, --yes", t("Answer yes to all confirmations"))
  .option("--dry-run", t("Do not execute the operation"))
  .action(async function (alias) {
    const mergedOptions = this.optsWithGlobals();
    const logger = createLogger(mergedOptions as LogLevelArgs);
    await using client = await createClient(
      logger,
      mergedOptions as CreateClientArgs & LogLevelArgs,
    );

    const { yes = false, dryRun = false } = mergedOptions;
    await removeRuntimeEngine(logger, client, alias, yes, dryRun);
  });

export const remove = removeCommand;
