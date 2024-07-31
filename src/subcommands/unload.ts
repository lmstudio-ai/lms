import { makeTitledPrettyError, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import chalk from "chalk";
import { boolean, command, flag, optional, positional, string } from "cmd-ts";
import fuzzy from "fuzzy";
import inquirer from "inquirer";
import inquirerPrompt from "inquirer-autocomplete-prompt";
import { createClient, createClientArgs } from "../createClient";
import { createLogger, logLevelArgs } from "../logLevel";
import { install } from "cmd-ts";

export const unload = command({
  name: "unload",
  description: "Unload a model",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
    identifier: positional({
      type: optional(string),
      description: text`
        The identifier of the model to unload. If not provided, you will be prompted to select a
        model from a list interactively.
      `,
      displayName: "identifier",
    }),
    all: flag({
      type: boolean,
      description: "Unload all models",
      long: "all",
      short: "a",
    }),
  },
  handler: async args => {
    const { identifier, all } = args;
    const logger = createLogger(args);
    const client = await createClient(logger, args);

    if (all && identifier !== undefined) {
      logger.errorWithoutPrefix(
        makeTitledPrettyError(
          "Invalid Usage",
          text`
            You cannot provide ${chalk.cyanBright("[path]")} when the flag
            ${chalk.yellowBright("--all")} is set.
          `,
        ).message,
      );
    }
    const models = await client.llm.listLoaded();
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

    if (all) {
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
              Cannot find a model with the identifier "${chalk.yellowBright(identifier)}".

              To see a list of loaded models, run:

                  ${chalk.yellowBright("lms ps")}
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
        logger.error(`You don't have any models loaded. Use "lms load --gpu max" to load a model.`);
        process.exit(1);
      }
      console.info();
      console.info(
        chalk.gray("! Use the arrow keys to navigate, type to filter, and press enter to select."),
      );
      console.info(chalk.gray("! To unload all models, use the --all flag."));
      console.info();
      const prompt = inquirer.createPromptModule({ output: process.stderr });
      prompt.registerPrompt("autocomplete", inquirerPrompt);
      const { selected } = await prompt({
        type: "autocomplete",
        name: "selected",
        message: chalk.greenBright("Select a model to unload") + chalk.gray(" |"),
        initialSearch: "",
        loop: false,
        pageSize: terminalSize().rows - 5,
        emptyText: "No loaded model matched the filter",
        source: async (_: any, input: string) => {
          input = input.split("?").join(""); // Strip the question mark to prevent issues
          const options = fuzzy.filter(input ?? "", modelSearchStrings, {
            pre: "\x1b[91m",
            post: "\x1b[39m",
          });
          return options.map(option => {
            const model = models[option.index];
            const questionMarkIndex = option.string.lastIndexOf("?");
            const displayName =
              option.string.slice(0, questionMarkIndex) +
              chalk.gray(option.string.slice(questionMarkIndex + 1));
            return {
              value: model,
              short: models[option.index].identifier,
              name: displayName,
            };
          });
        },
      } as any);
      logger.debug(`Unloading "${selected}"...`);
      await client.llm.unload(selected.identifier);
      logger.info(`Model "${selected.identifier}" unloaded.`);
    }
  },
});
