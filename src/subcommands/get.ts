import { text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import { type ModelCompatibilityType } from "@lmstudio/lms-shared-types";
import { type ModelSearchResultDownloadOption, type ModelSearchResultEntry } from "@lmstudio/sdk";
import chalk from "chalk";
import { boolean, command, flag, option, optional, positional, string } from "cmd-ts";
import inquirer from "inquirer";
import { askQuestion } from "../confirm";
import { createClient, createClientArgs } from "../createClient";
import { formatSizeBytes1000 } from "../formatSizeBytes1000";
import { createLogger, logLevelArgs } from "../logLevel";
import { ProgressBar } from "../ProgressBar";
import { refinedNumber } from "../types/refinedNumber";

function formatRemainingTime(timeSeconds: number) {
  const seconds = timeSeconds % 60;
  const minutes = Math.floor(timeSeconds / 60) % 60;
  const hours = Math.floor(timeSeconds / 3600);
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export const get = command({
  name: "get",
  description: "Searching and downloading a model from online.",
  args: {
    modelName: positional({
      type: optional(string),
      description: text`
        The model to download. If not provided, staff picked models will be shown. For models that
        have multiple quantizations, you can specify the quantization by appending it with "@". For
        example, use "llama-3.1-8b@q4_k_m" to download the llama-3.1-8b model with the specified
        quantization.
      `,
    }),
    mlx: flag({
      type: boolean,
      long: "mlx",
      description: text`
        Whether to include MLX models in the search results. If any of "--mlx" or "--gguf" flag is
        specified, only models that match the specified flags will be shown; Otherwise only models
        supported by your installed LM Runtimes will be shown.
      `,
    }),
    gguf: flag({
      type: boolean,
      long: "gguf",
      description: text`
        Whether to include GGUF models in the search results. If any of "--mlx" or "--gguf" flag
        is specified, only models that match the specified flags will be shown; Otherwise only
        models supported by your installed LM Runtimes will be shown.
      `,
    }),
    limit: option({
      type: optional(refinedNumber({ integer: true, min: 1 })),
      long: "limit",
      short: "n",
      description: "Limit the number of model options.",
    }),
    alwaysShowAllResults: flag({
      type: boolean,
      long: "always-show-all-results",
      description: text`
        By default, an exact model match to the query is automatically selected. If this flag is
        specified, you're prompted to choose from the model results, even when there's an exact
        match.
      `,
    }),
    alwaysShowDownloadOptions: flag({
      type: boolean,
      long: "always-show-download-options",
      short: "a",
      description: text`
        By default, if there an exact match for your query, the system will automatically select a
        quantization based on your hardware. Specifying this flag will always prompt you to choose
        a download option.
      `,
    }),
    ...logLevelArgs,
    ...createClientArgs,
    yes: flag({
      type: boolean,
      long: "yes",
      short: "y",
      description: text`
        Suppress all confirmations and warnings. Useful for scripting. If there are multiple
        models matching the search term, the first one will be used. If there are multiple download
        options, the recommended one based on your hardware will be chosen. Fails if you have
        specified a quantization via the "@" syntax and the quantization does not exist in the
        options.
      `,
    }),
  },
  handler: async args => {
    const { modelName, mlx, gguf, limit, alwaysShowAllResults, alwaysShowDownloadOptions, yes } =
      args;
    const logger = createLogger(args);
    if (yes && alwaysShowAllResults) {
      logger.error("You cannot use the --yes flag with the --always-show-all-results flag.");
      process.exit(1);
    }
    if (yes && alwaysShowDownloadOptions) {
      logger.error("You cannot use the --yes flag with the --always-show-download-options flag.");
      process.exit(1);
    }
    const client = await createClient(logger, args);
    let compatibilityTypes: Array<ModelCompatibilityType> | undefined = undefined;
    if (mlx || gguf) {
      compatibilityTypes = [];
      if (mlx) {
        compatibilityTypes.push("safetensors");
      }
      if (gguf) {
        compatibilityTypes.push("gguf");
      }
    }
    let searchTerm: string | undefined;
    let specifiedQuantName: string | undefined;
    if (modelName !== undefined) {
      const splitByAt = modelName.split("@");
      if (splitByAt.length >= 3) {
        logger.error("You cannot have more than 2 @'s in the model name argument.");
        process.exit(1);
      }
      searchTerm = splitByAt[0];
      if (splitByAt.length === 2) {
        specifiedQuantName = splitByAt[1];
      }
    }

    if (specifiedQuantName !== undefined && alwaysShowDownloadOptions) {
      logger.errorText`
        You cannot specify a quantization and use the "--always-show-download-options" flag at the
        same time.
      `;
      process.exit(1);
    }

    if (searchTerm !== undefined) {
      logger.info("Searching for models with the term", chalk.yellowBright(searchTerm));
    }

    const opts = {
      searchTerm,
      compatibilityTypes,
      limit,
    };
    logger.debug("Searching for models with options", opts);
    const results = await client.repository.searchModels(opts);
    logger.debug(`Found ${results.length} result(s)`);

    if (results.length === 0) {
      logger.error("No models found with the specified search criteria.");
      process.exit(1);
    }

    const exactMatchIndex = results.findIndex(result => result.isExactMatch());
    const hasExactMatch = exactMatchIndex !== -1;
    let model: ModelSearchResultEntry;
    if (hasExactMatch && !alwaysShowAllResults) {
      logger.debug("Automatically selecting an exact match model at index", exactMatchIndex);
      model = results[exactMatchIndex];
    } else {
      if (yes) {
        logger.info("Multiple models found. Automatically selecting the first one due to --yes.");
        model = results[0];
      } else {
        logger.debug("Prompting user to choose a model");
        logger.info("No exact match found. Please choose a model from the list below.");
        logger.infoWithoutPrefix();
        model = await askToChooseModel(results, 2);
      }
    }
    const options = await model.getDownloadOptions();
    if (options.length === 0) {
      logger.error("No compatible download options available for this model.");
      process.exit(1);
    }

    const recommendedOptionIndex = options.findIndex(option => option.isRecommended());
    let option: ModelSearchResultDownloadOption;
    let shouldShowOptions = true;
    let additionalRowsToReserve = 0;
    let currentChoiceIndex: number = 0;
    /**
     * If set to true, meaning we absolutely cannot make a decision if the user does not intervene.
     * This is triggered by specifying a quantization that does not exist in the options.
     */
    let noDeterminantOption = false;

    if (specifiedQuantName !== undefined) {
      const specifiedQuantLower = specifiedQuantName.toLowerCase();
      const specifiedQuantOptionIndex = options.findIndex(
        option => (option.quantization ?? "").toLowerCase() === specifiedQuantLower,
      );
      if (specifiedQuantOptionIndex === -1) {
        if (!yes) {
          logger.warnWithoutPrefix();
          logger.warnText`
            Cannot find a download option with quantization "${specifiedQuantName}". Please choose
            one from the following options.
          `;
          logger.warnWithoutPrefix();
        }
        additionalRowsToReserve += 2;
        noDeterminantOption = true;
        shouldShowOptions = true;
      } else {
        currentChoiceIndex = specifiedQuantOptionIndex;
        shouldShowOptions = false;
      }
    } else {
      if (recommendedOptionIndex !== -1) {
        currentChoiceIndex = recommendedOptionIndex;
      }
      if (hasExactMatch && !alwaysShowDownloadOptions) {
        logger.info(
          "Based on your hardware, choosing the recommended option:",
          formatOptionShortName(options[currentChoiceIndex]),
        );
        shouldShowOptions = false;
      } else {
        shouldShowOptions = true;
      }
    }

    if (alwaysShowDownloadOptions) {
      shouldShowOptions = true;
    }

    if (yes) {
      if (noDeterminantOption) {
        logger.error(
          "You have specified a quantization that does not exist. Here are the available options:",
        );
        for (const option of options) {
          logger.error(`- ${formatOptionShortName(option)}`);
        }
        logger.error("Exiting because of the --yes flag.");
        process.exit(1);
      }
      shouldShowOptions = false;
    }

    if (shouldShowOptions) {
      logger.debug("Prompting user to choose a download option");
      option = await askToChooseDownloadOption(
        options,
        currentChoiceIndex,
        additionalRowsToReserve,
      );
    } else {
      logger.debug(`Automatically selecting option at ${currentChoiceIndex}`);
      option = options[currentChoiceIndex];
    }

    logger.info("Downloading", formatOptionShortName(option));

    let isAskingExitingBehavior = false;
    let canceled = false;
    const pb = new ProgressBar(0, "", 22);
    const abortController = new AbortController();
    const sigintListener = () => {
      process.removeListener("SIGINT", sigintListener);
      process.on("SIGINT", () => {
        logger.infoWithoutPrefix();
        logger.info("Download will continue in the background.");
        process.exit(1);
      });
      pb.stopWithoutClear();
      isAskingExitingBehavior = true;
      logger.infoWithoutPrefix();
      process.stdin.resume();
      askQuestion("Continue to download in the background?").then(confirmed => {
        if (confirmed) {
          logger.info("Download will continue in the background.");
          process.exit(1);
        } else {
          logger.warn("Download canceled.");
          abortController.abort();
          canceled = true;
        }
      });
    };
    process.addListener("SIGINT", sigintListener);
    let longestDownloadedBytesStringLength = 6;
    let longestTotalBytesStringLength = 6;
    let longestSpeedBytesPerSecondStringLength = 6;
    try {
      let alreadyExisted = true;
      const defaultIdentifier = await option.download({
        onProgress: ({ downloadedBytes, totalBytes, speedBytesPerSecond }) => {
          alreadyExisted = false;
          if (isAskingExitingBehavior) {
            return;
          }
          const downloadedBytesString = formatSizeBytes1000(downloadedBytes);
          if (downloadedBytesString.length > longestDownloadedBytesStringLength) {
            longestDownloadedBytesStringLength = downloadedBytesString.length;
          }
          const totalBytesString = formatSizeBytes1000(totalBytes);
          if (totalBytesString.length > longestTotalBytesStringLength) {
            longestTotalBytesStringLength = totalBytesString.length;
          }
          const speedBytesPerSecondString = formatSizeBytes1000(speedBytesPerSecond);
          if (speedBytesPerSecondString.length > longestSpeedBytesPerSecondStringLength) {
            longestSpeedBytesPerSecondStringLength = speedBytesPerSecondString.length;
          }
          const timeLeftSeconds = Math.round((totalBytes - downloadedBytes) / speedBytesPerSecond);
          pb.setRatio(
            downloadedBytes / totalBytes,
            text`
              ${downloadedBytesString.padStart(longestDownloadedBytesStringLength)} /
              ${totalBytesString.padStart(longestTotalBytesStringLength)} |
              ${speedBytesPerSecondString.padStart(longestSpeedBytesPerSecondStringLength)}/s | ETA
              ${formatRemainingTime(timeLeftSeconds)}
            `,
          );
        },
        onStartFinalizing: () => {
          alreadyExisted = false;
          if (isAskingExitingBehavior) {
            return;
          }
          pb.stop();
          logger.info("Finalizing download...");
        },
        signal: abortController.signal,
      });
      pb.stopIfNotStopped();
      if (canceled) {
        process.exit(1);
      }
      process.removeListener("SIGINT", sigintListener);
      if (alreadyExisted) {
        logger.infoText`
          You already have this model. You can load it with:
          ${chalk.yellowBright("\n\n    lms load " + defaultIdentifier)}
        `;
      } else {
        logger.infoText`
          Download completed. You can load the model with:
          ${chalk.yellowBright("\n\n    lms load " + defaultIdentifier)}
        `;
      }
      logger.info();
    } catch (e: any) {
      if (e.name === "AbortError") {
        process.exit(1);
      } else {
        throw e;
      }
    }
  },
});

async function askToChooseModel(
  models: Array<ModelSearchResultEntry>,
  additionalRowsToReserve = 0,
): Promise<ModelSearchResultEntry> {
  const prompt = inquirer.createPromptModule({ output: process.stderr });
  console.info(chalk.gray("! Use the arrow keys to navigate, and press enter to select."));
  console.info();
  const answers = await prompt([
    {
      type: "list",
      name: "model",
      message: chalk.greenBright("Select a model to download"),
      loop: false,
      pageSize: terminalSize().rows - 4 - additionalRowsToReserve,
      choices: models.map(model => {
        let name: string = "";
        if (model.isStaffPick()) {
          name += chalk.cyanBright("[Staff Pick] ");
        }
        if (model.isExactMatch()) {
          name += chalk.yellowBright("[Exact Match] ");
        }
        name += model.name;
        return {
          name,
          value: model,
          short: model.name,
        };
      }),
    },
  ]);
  return answers.model;
}

async function askToChooseDownloadOption(
  downloadOptions: Array<ModelSearchResultDownloadOption>,
  defaultIndex: number,
  additionalRowsToReserve = 0,
): Promise<ModelSearchResultDownloadOption> {
  const prompt = inquirer.createPromptModule({ output: process.stderr });
  console.info(chalk.gray("! Use the arrow keys to navigate, and press enter to select."));
  console.info();
  const answers = await prompt([
    {
      type: "list",
      name: "option",
      default: defaultIndex,
      message: chalk.greenBright("Select an option to download"),
      loop: false,
      pageSize: terminalSize().rows - 4 - additionalRowsToReserve,
      choices: downloadOptions.map(option => {
        let name = "";
        if (option.quantization) {
          name += chalk.whiteBright(`${option.quantization} `.padEnd(9));
        }
        name += chalk.whiteBright(`${formatSizeBytes1000(option.sizeBytes)} `.padStart(11));
        name += chalk.gray(option.name) + " ";
        switch (option.fitEstimation) {
          case "willNotFit":
            name += chalk.redBright("[Likely too large for this machine]");
            break;
          case "fitWithoutGPU":
            name += chalk.greenBright("[Likely fit]");
            break;
          case "partialGPUOffload":
            name += chalk.yellowBright("[Partial GPU offload possible]");
            break;
          case "fullGPUOffload":
            name += chalk.greenBright("[Full GPU offload possible]");
            break;
        }
        if (option.isRecommended()) {
          name += " " + chalk.bgGreenBright.white(" Recommended ");
        }
        return {
          name,
          value: option,
          short: formatOptionShortName(option),
        };
      }),
    },
  ]);
  return answers.option;
}

function formatOptionShortName(option: ModelSearchResultDownloadOption) {
  let name = "";
  name += option.name;
  if (option.quantization) {
    name += ` [${option.quantization}]`;
  }
  name += ` (${formatSizeBytes1000(option.sizeBytes)})`;
  return name;
}
