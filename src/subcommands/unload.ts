import { Command, type OptionValues } from "@commander-js/extra-typings";
import { search } from "@inquirer/prompts";
import { makeTitledPrettyError, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import chalk from "chalk";
import fuzzy from "fuzzy";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { runPromptWithExitHandling } from "../prompt.js";
import { fuzzyHighlightOptions, searchTheme } from "../inquirerTheme.js";

type UnloadCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    all?: boolean;
  };

const unloadCommand = new Command<[], UnloadCommandOptions>()
  .name("unload")
  .description("Unload a model")
  .argument(
    "[identifier]",
    text`
      The identifier of the model to unload. If not provided and exactly one model is loaded, it
      will be unloaded automatically. Otherwise, you will be prompted to select a model
      interactively from a list.
    `,
  )
  .option("-a, --all", "Unload all models");

addCreateClientOptions(unloadCommand);
addLogLevelOptions(unloadCommand);

unloadCommand.action(async (identifier, options: UnloadCommandOptions) => {
  const unloadAll = options.all === true;
  const logger = createLogger(options);
  await using client = await createClient(logger, options);

  if (unloadAll === true && identifier !== undefined) {
    logger.errorWithoutPrefix(
      makeTitledPrettyError(
        "Invalid Usage",
        text`
          You cannot provide ${chalk.cyan("[path]")} when the flag
          ${chalk.yellow("--all")} is set.
        `,
      ).message,
    );
  }
  const models = (
    await Promise.all([client.llm.listLoaded(), client.embedding.listLoaded()])
  ).flat();
  const modelSearchStrings = models.map(({ identifier, path }) => {
    // The question mark here is a hack to apply gray color to the path part of the string.
    // It cannot be a part of the path, so we can find it by .lastIndexOf.
    // It will be stripped before outputting.
    if (identifier === path) {
      return identifier + "?";
    }
    if (identifier.startsWith(path + ":")) {
      return identifier + "?";
    }
    return `${identifier} ?(${path})`;
  });

  if (unloadAll === true) {
    if (models.length === 0) {
      logger.info("No models to unload.");
    } else {
      logger.debug(`Unloading ${models.length} models...`);
      for (const model of models) {
        logger.info(`Unloading "${model.identifier}"...`);
        await client.llm.unload(model.identifier);
      }
      if (models.length > 1) {
        logger.info(`Unloaded ${models.length} models.`);
      } else {
        logger.info(`Unloaded 1 model.`);
      }
    }
  } else if (identifier !== undefined) {
    if (!models.some(m => m.identifier === identifier)) {
      logger.errorWithoutPrefix(
        makeTitledPrettyError(
          "Model Not Found",
          text`
            Cannot find a model with the identifier "${chalk.yellow(identifier)}".

            To see a list of loaded models, run:

                ${chalk.yellow("lms ps")}
          `,
        ).message,
      );
      return;
    }
    logger.debug(`Unloading "${identifier}"...`);
    await client.llm.unload(identifier);
    logger.info(`Model "${identifier}" unloaded.`);
  } else {
    if (models.length === 0) {
      logger.info(`You don't have any models loaded. Use "lms load" to load a model.`);
      process.exit(1);
    }
    // If there is exactly one model loaded, unload it automatically without prompting.
    if (models.length === 1) {
      const model = models[0];
      logger.debug(`Unloading "${model.identifier}"...`);
      await client.llm.unload(model.identifier);
      logger.info(`Model "${model.identifier}" unloaded.`);
      return;
    }
    console.info(chalk.dim("! To unload all models, use the --all flag."));
    console.info();
    const pageSize = terminalSize().rows - 5;
    const selected = await runPromptWithExitHandling(() =>
      search<(typeof models)[number]>(
        {
          message: chalk.green("Select a model to unload") + chalk.dim(" |"),
          pageSize,
          theme: searchTheme,
          source: async (input: string | undefined, { signal }: { signal: AbortSignal }) => {
            void signal;
            const sanitizedInput = (input ?? "").split("?").join("");
            const options = fuzzy.filter(sanitizedInput, modelSearchStrings, fuzzyHighlightOptions);
            return options.map(option => {
              const model = models[option.index];
              const questionMarkIndex = option.string.lastIndexOf("?");
              const displayName =
                option.string.slice(0, questionMarkIndex) +
                chalk.dim(option.string.slice(questionMarkIndex + 1));
              return {
                value: model,
                short: models[option.index].identifier,
                name: displayName,
              };
            });
          },
        },
        { output: process.stderr },
      ),
    );
    logger.debug(`Unloading "${selected}"...`);
    await client.llm.unload(selected.identifier);
    logger.info(`Model "${selected.identifier}" unloaded.`);
  }
});

export const unload = unloadCommand;
