import { Command } from "@commander-js/extra-typings";
import { SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import { askQuestion } from "../../confirm.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { resolveAlias } from "./aliasResolution.js";

async function removeRuntimeEngine(
  logger: SimpleLogger,
  client: LMStudioClient,
  alias: string,
  yes: boolean,
  dryRun: boolean,
) {
  const engineInfos = await client.runtime.engine.list();
  // TODO(will): Match multiple aliases
  const choices = [resolveAlias(logger, engineInfos, alias, false, undefined)];
  const fullAliases = choices.map(choice => choice.name + "-" + choice.version);
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
