import { type SimpleLogger, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import {
  type ArtifactDownloadPlan,
  type ArtifactDownloadPlanModelInfo,
  kebabCaseRegex,
  kebabCaseWithDotsRegex,
  type ModelCompatibilityType,
} from "@lmstudio/lms-shared-types";
import {
  type LMStudioClient,
  type ModelSearchResultDownloadOption,
  type ModelSearchResultEntry,
} from "@lmstudio/sdk";
import chalk from "chalk";
import { boolean, command, flag, option, optional, positional, string } from "cmd-ts";
import inquirer from "inquirer";
import { askQuestion } from "../confirm.js";
import { createClient, createClientArgs } from "../createClient.js";
import { createDownloadPbUpdater } from "../downloadPbUpdater.js";
import { formatSizeBytes1000, formatSizeBytesWithColor1000 } from "../formatSizeBytes1000.js";
import { createLogger, logLevelArgs } from "../logLevel.js";
import { ProgressBar } from "../ProgressBar.js";
import { refinedNumber } from "../types/refinedNumber.js";

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

    if (modelName !== undefined && modelName.split("/").length === 2) {
      // New lms get behavior: download artifact
      if (mlx) {
        logger.error("You cannot use the --mlx flag when an exact artifact is specified.");
        process.exit(1);
      }
      if (gguf) {
        logger.error("You cannot use the --gguf flag when an exact artifact is specified.");
        process.exit(1);
      }
      if (limit !== undefined) {
        logger.error("You cannot use the --limit flag when an exact artifact is specified.");
        process.exit(1);
      }
      if (alwaysShowAllResults) {
        logger.error(
          "You cannot use the --always-show-all-results flag when a exact artifact is specified.",
        );
        process.exit(1);
      }
      if (alwaysShowDownloadOptions) {
        logger.errorText`
          You cannot use the --always-show-download-options flag when a exact artifact is specified.
        `;
        process.exit(1);
      }
      const [owner, name] = modelName.toLowerCase().split("/");
      if (!kebabCaseRegex.test(owner)) {
        logger.error("Invalid artifact owner:", owner);
        process.exit(1);
      }
      if (!kebabCaseWithDotsRegex.test(name)) {
        logger.error("Invalid artifact name:", name);
        process.exit(1);
      }
      await downloadArtifact(client, logger, owner, name, yes);
      return;
    }

    // Legacy lms get behavior

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
    const updatePb = createDownloadPbUpdater(pb);
    const abortController = new AbortController();
    const sigintListener = () => {
      process.removeListener("SIGINT", sigintListener);
      process.once("SIGINT", () => {
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
    try {
      let alreadyExisted = true;
      const defaultIdentifier = await option.download({
        onProgress: update => {
          alreadyExisted = false;
          if (isAskingExitingBehavior) {
            return;
          }
          updatePb(update);
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

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const tableVerticalLine = chalk.gray("│");
const tableBranch = chalk.gray("├");
const tableLastBranch = chalk.gray("└");
const tableHorizontalLine = chalk.gray("─");

function modelToString(model: ArtifactDownloadPlanModelInfo) {
  let result = model.displayName;
  if (model.quantName !== undefined) {
    result += ` ${model.quantName}`;
  }
  if (model.compatibilityType === "gguf") {
    result += " [GGUF]";
  } else if (model.compatibilityType === "safetensors") {
    result += " [MLX]";
  }
  return result;
}

const toDownloadText = chalk.yellowBright("🡇 To download:");

async function artifactDownloadPlanToString(
  plan: ArtifactDownloadPlan,
  lines: Array<string>,
  spinnerFrame: number,
  currentNodeIndex = 0,
  selfPrefix = "",
  subSequentPrefix = "",
) {
  const node = plan.nodes[currentNodeIndex];
  if (node === undefined) {
    lines.push(chalk.redBright("<Invalid: node not found>"));
    return;
  }
  const nodeType = node.type;
  switch (nodeType) {
    case "artifact": {
      // Logic to print artifact node.
      let message: string;
      const nodeState = node.state;
      const artifactName = `${node.owner}/${node.name}`;
      switch (nodeState) {
        case "pending": {
          message = `⧗ ${chalk.white(artifactName)} ${chalk.white("- Pending...")}`;
          break;
        }
        case "fetching": {
          message = `${spinnerFrames[(spinnerFrame + currentNodeIndex) % spinnerFrames.length]} ${chalk.whiteBright(artifactName)} ${chalk.gray("- Resolving...")}`;
          break;
        }
        case "satisfied": {
          message = `${chalk.greenBright("✓ Satisfied")} ${chalk.whiteBright(artifactName)}`;
          break;
        }
        case "completed": {
          message =
            `${toDownloadText} ` +
            `${node.artifactType} ${chalk.whiteBright(artifactName)} - ` +
            `${formatSizeBytesWithColor1000(node.sizeBytes ?? 0)}`;
          break;
        }
        default: {
          const exhaustiveCheck: never = nodeState;
          throw new Error(`Unexpected node state: ${exhaustiveCheck}`);
        }
      }
      lines.push(selfPrefix + message);
      for (let i = 0; i < node.dependencyNodes.length; i++) {
        const isLast = i === node.dependencyNodes.length - 1;
        artifactDownloadPlanToString(
          plan,
          lines,
          spinnerFrame,
          node.dependencyNodes[i],
          isLast
            ? subSequentPrefix + " " + tableLastBranch + tableHorizontalLine + " "
            : subSequentPrefix + " " + tableBranch + tableHorizontalLine + " ",
          isLast ? subSequentPrefix + "   " : subSequentPrefix + " " + tableVerticalLine + " ",
        );
      }
      break;
    }
    case "model": {
      let message: string;
      const nodeState = node.state;
      switch (nodeState) {
        case "pending": {
          message = `⧗ ${chalk.white("Concrete Model")} ${chalk.white("- Pending...")}`;
          break;
        }
        case "fetching": {
          message = `${spinnerFrames[(spinnerFrame + currentNodeIndex) % spinnerFrames.length]} ${chalk.gray(`Finding options based on your system... (${node.resolvedSources}/${node.totalSources})`)}`;
          break;
        }
        case "satisfied": {
          const owned = node.alreadyOwned;
          if (owned === undefined) {
            message = `${chalk.greenBright("✓ Satisfied")} ${chalk.whiteBright("Unknown")}`;
          } else {
            message = `${chalk.greenBright("✓ Satisfied")} ${chalk.whiteBright(modelToString(owned))}`;
          }
          break;
        }
        case "completed": {
          const selected = node.selected;
          if (selected === undefined) {
            message = `${toDownloadText} ${chalk.whiteBright("Unknown")}`;
          } else {
            message =
              `${toDownloadText} ` +
              `${chalk.whiteBright(modelToString(selected))} - ` +
              `${formatSizeBytesWithColor1000(selected.sizeBytes)}`;
          }
          break;
        }
        default: {
          const exhaustiveCheck: never = nodeState;
          throw new Error(`Unexpected node state: ${exhaustiveCheck}`);
        }
      }
      lines.push(selfPrefix + message);
      break;
    }
    default: {
      const exhaustiveCheck: never = nodeType;
      throw new Error(`Unexpected node type: ${exhaustiveCheck}`);
    }
  }
}

async function downloadArtifact(
  client: LMStudioClient,
  logger: SimpleLogger,
  owner: string,
  name: string,
  yes: boolean,
) {
  console.info();
  let downloadPlan: ArtifactDownloadPlan = {
    nodes: [
      {
        type: "artifact",
        owner,
        name,
        state: "pending",
        dependencyNodes: [],
      },
    ],
    downloadSizeBytes: 0,
  };
  let linesToClear: number = 0;
  const reprintDownloadPlan = (isFinished: boolean) => {
    // Move cursor up by lastLines
    process.stdout.moveCursor(0, -linesToClear);
    const lines: Array<string> = [];
    const spinnerFrame = Math.floor(Date.now() / 100) % spinnerFrames.length;
    artifactDownloadPlanToString(downloadPlan, lines, spinnerFrame, 0, "   ", "  ");
    lines.push("");

    if (isFinished) {
      if (downloadPlan.downloadSizeBytes === 0) {
        lines.push(chalk.greenBright("✓ You already have everything. Nothing to download."));
      } else {
        if (yes) {
          lines.push(
            chalk.yellowBright(
              `Resolution completed. Downloading ${formatSizeBytes1000(downloadPlan.downloadSizeBytes)}...`,
            ),
          );
        } else {
          lines.push(
            chalk.yellowBright(
              `About to download ${formatSizeBytes1000(downloadPlan.downloadSizeBytes)}.`,
            ),
          );
        }
      }
    } else {
      if (downloadPlan.downloadSizeBytes > 0) {
        lines.push(
          chalk.gray(
            spinnerFrames[spinnerFrame] +
              ` Resolving download plan... (${formatSizeBytes1000(downloadPlan.downloadSizeBytes)})`,
          ),
        );
      } else {
        lines.push(
          chalk.gray(
            spinnerFrames[(spinnerFrame + 5) % spinnerFrames.length] +
              " Resolving download plan...",
          ),
        );
      }
    }

    linesToClear = Math.max(lines.length, linesToClear);
    for (const line of lines) {
      process.stdout.write("\r" + line + "\x1b[0K\n");
    }
  };
  process.stdout.write("\x1B[?25l");
  using downloadPlanner = client.repository.createArtifactDownloadPlanner({
    owner,
    name,
    onPlanUpdated: newPlan => {
      downloadPlan = newPlan;
      reprintDownloadPlan(false);
    },
  });
  reprintDownloadPlan(false);
  const autoReprintInterval = setInterval(() => {
    reprintDownloadPlan(false);
  }, 50);
  await downloadPlanner.untilReady();
  reprintDownloadPlan(true);
  process.stdout.write("\x1B[?25h");
  clearInterval(autoReprintInterval);

  if (downloadPlan.downloadSizeBytes === 0) {
    process.exit(0);
  }
  if (!yes) {
    const confirmed = await askQuestion("Continue?");
    if (!confirmed) {
      process.exit(1);
    }
  }

  // Duplicated logic for downloading artifact. Will be cleaned up when we move to artifact download
  // only.
  let isAskingExitingBehavior = false;
  let canceled = false;
  const pb = new ProgressBar(0, "", 22);
  const updatePb = createDownloadPbUpdater(pb);
  const abortController = new AbortController();
  const sigintListener = () => {
    process.removeListener("SIGINT", sigintListener);
    process.once("SIGINT", () => {
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
  try {
    await downloadPlanner.download({
      onProgress: update => {
        if (isAskingExitingBehavior) {
          return;
        }
        updatePb(update);
      },
      onStartFinalizing: () => {
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
    logger.infoText`
      Download completed.
    `;
    logger.info();
  } catch (e: any) {
    if (e.name === "AbortError") {
      process.exit(1);
    } else {
      throw e;
    }
  }
}
