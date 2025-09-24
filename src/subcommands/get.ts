import { Command, Option } from "@commander-js/extra-typings";
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
import inquirer from "inquirer";
import { askQuestion } from "../confirm.js";
import { addCreateClientOptions, createClient } from "../createClient.js";
import { createDownloadPbUpdater } from "../downloadPbUpdater.js";
import { formatSizeBytes1000, formatSizeBytesWithColor1000 } from "../formatSizeBytes1000.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";
import { ProgressBar } from "../ProgressBar.js";
import { createRefinedNumberParser } from "../types/refinedNumber.js";
import inquirerPrompt from "inquirer-autocomplete-prompt";
import fuzzy from "fuzzy";

export const get = addLogLevelOptions(
  addCreateClientOptions(
    new Command()
      .name("get")
      .description("Searching and downloading a model from online.")
      .argument(
        "[modelName]",
        text`
          The model to download. If not provided, staff picked models will be shown. For models that
          have multiple quantizations, you can specify the quantization by appending it with "@". For
          example, use "llama-3.1-8b@q4_k_m" to download the llama-3.1-8b model with the specified
          quantization.
        `,
      )
      .option(
        "--mlx",
        text`
          Whether to include MLX models in the search results. If any of "--mlx" or "--gguf" flag is
          specified, only models that match the specified flags will be shown; Otherwise only models
          supported by your installed LM Runtimes will be shown.
        `,
      )
      .option(
        "--gguf",
        text`
          Whether to include GGUF models in the search results. If any of "--mlx" or "--gguf" flag
          is specified, only models that match the specified flags will be shown; Otherwise only
          models supported by your installed LM Runtimes will be shown.
        `,
      )
      .addOption(
        new Option("-n, --limit <value>", "Limit the number of model options.").argParser(
          createRefinedNumberParser({ integer: true, min: 1 }),
        ),
      )
      .option(
        "--always-show-all-results",
        text`
          By default, an exact model match to the query is automatically selected. If this flag is
          specified, you're prompted to choose from the model results, even when there's an exact
          match.
        `,
      )
      .option(
        "-a, --always-show-download-options",
        text`
          By default, if there an exact match for your query, the system will automatically select a
          quantization based on your hardware. Specifying this flag will always prompt you to choose
          a download option.
        `,
      )
      .option(
        "-y, --yes",
        text`
          Suppress all confirmations and warnings. Useful for scripting. If there are multiple
          models matching the search term, the first one will be used. If there are multiple download
          options, the recommended one based on your hardware will be chosen. Fails if you have
          specified a quantization via the "@" syntax and the quantization does not exist in the
          options.
        `,
      ),
  ),
).action(async (modelName, options) => {
  const {
    mlx = false,
    gguf = false,
    limit,
    alwaysShowAllResults = false,
    alwaysShowDownloadOptions = false,
    yes = false,
  } = options;
  const logger = createLogger(options);
  if (yes && alwaysShowAllResults) {
    logger.error("You cannot use the --yes flag with the --always-show-all-results flag.");
    process.exit(1);
  }
  if (yes && alwaysShowDownloadOptions) {
    logger.error("You cannot use the --yes flag with the --always-show-download-options flag.");
    process.exit(1);
  }
  const client = await createClient(logger, options);

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
    logger.info("Searching for models with the term", chalk.yellow(searchTerm));
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
  const downloadOptions = await model.getDownloadOptions();
  if (downloadOptions.length === 0) {
    logger.error("No compatible download options available for this model.");
    process.exit(1);
  }

  const recommendedOptionIndex = downloadOptions.findIndex(option => option.isRecommended());
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
    const specifiedQuantOptionIndex = downloadOptions.findIndex(
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
        formatOptionShortName(downloadOptions[currentChoiceIndex]),
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
      for (const option of downloadOptions) {
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
      downloadOptions,
      currentChoiceIndex,
      additionalRowsToReserve,
    );
  } else {
    logger.debug(`Automatically selecting option at ${currentChoiceIndex}`);
    option = downloadOptions[currentChoiceIndex];
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
        ${chalk.yellow("\n\n    lms load " + defaultIdentifier)}
      `;
    } else {
      logger.infoText`
        Download completed. You can load the model with:
        ${chalk.yellow("\n\n    lms load " + defaultIdentifier)}
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
});

async function askToChooseModel(
  models: Array<ModelSearchResultEntry>,
  additionalRowsToReserve = 0,
): Promise<ModelSearchResultEntry> {
  const prompt = inquirer.createPromptModule({ output: process.stderr });
  prompt.registerPrompt("autocomplete", inquirerPrompt);
  console.info(
    chalk.gray("! Use the arrow keys to navigate, type to filter, and press enter to select."),
  );
  console.info();
  const modelNames = models.map(model => model.name);
  const answers = await prompt([
    {
      type: "autocomplete",
      name: "model",
      message: "Select a model to download",
      loop: false,
      pageSize: terminalSize().rows - 4 - additionalRowsToReserve,
      emptyText: "No model matched the filter",
      source: async (_: any, input: string) => {
        const options = fuzzy.filter(input ?? "", modelNames, {
          pre: "\x1b[91m",
          post: "\x1b[39m",
        });
        return options.map(option => {
          const model = models[option.index];
          let name: string = "";
          if (model.isStaffPick()) {
            name += "[Staff Pick] ";
          }
          if (model.isExactMatch()) {
            name += chalk.yellow("[Exact Match] ");
          }
          name += option.string;
          return {
            name,
            value: model,
            short: option.original,
          };
        });
      },
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
      message: chalk.green("Select an option to download"),
      loop: false,
      pageSize: terminalSize().rows - 4 - additionalRowsToReserve,
      choices: downloadOptions.map(option => {
        let name = "";
        if (option.quantization !== undefined && option.quantization !== "") {
          name += `${option.quantization} `.padEnd(9);
        }
        name += `${formatSizeBytes1000(option.sizeBytes)} `.padStart(11);
        name += chalk.gray(option.name) + " ";
        switch (option.fitEstimation) {
          case "willNotFit":
            name += chalk.red("[Likely too large for this machine]");
            break;
          case "fitWithoutGPU":
            name += chalk.green("[Likely fit]");
            break;
          case "partialGPUOffload":
            name += chalk.yellow("[Partial GPU offload possible]");
            break;
          case "fullGPUOffload":
            name += chalk.green("[Full GPU offload possible]");
            break;
        }
        if (option.isRecommended()) {
          name += " " + chalk.green(" Recommended ");
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
  if (option.quantization !== undefined && option.quantization !== "") {
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

const toDownloadText = chalk.yellow("↓ To download:");

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
    lines.push(chalk.red("<Invalid: node not found>"));
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
          message = `⧗ ${artifactName} - Pending...`;
          break;
        }
        case "fetching": {
          message = `${spinnerFrames[(spinnerFrame + currentNodeIndex) % spinnerFrames.length]} ${artifactName} ${chalk.gray("- Resolving...")}`;
          break;
        }
        case "satisfied": {
          message = `${chalk.green("✓ Satisfied")} ${artifactName}`;
          break;
        }
        case "completed": {
          message =
            `${toDownloadText} ` +
            `${node.artifactType} ${artifactName} - ` +
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
          message = `⧗ Concrete Model - Pending...`;
          break;
        }
        case "fetching": {
          message = `${spinnerFrames[(spinnerFrame + currentNodeIndex) % spinnerFrames.length]} ${chalk.gray(`Finding options based on your system... (${node.resolvedSources}/${node.totalSources})`)}`;
          break;
        }
        case "satisfied": {
          const owned = node.alreadyOwned;
          if (owned === undefined) {
            message = `${chalk.green("✓ Satisfied")} Unknown`;
          } else {
            message = `${chalk.green("✓ Satisfied")} ${modelToString(owned)}`;
          }
          break;
        }
        case "completed": {
          const selected = node.selected;
          if (selected === undefined) {
            message = `${toDownloadText} Unknown`;
          } else {
            message =
              `${toDownloadText} ` +
              `${modelToString(selected)} - ` +
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

export async function downloadArtifact(
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
    // Check if we can move the cursor up (Not available in non TTY environments)
    if (process.stdout.moveCursor !== undefined) {
      // Move cursor up by lastLines
      process.stdout.moveCursor(0, -linesToClear);
    }
    const lines: Array<string> = [];
    const spinnerFrame = Math.floor(Date.now() / 100) % spinnerFrames.length;
    artifactDownloadPlanToString(downloadPlan, lines, spinnerFrame, 0, "   ", "  ");
    lines.push("");

    if (isFinished) {
      if (downloadPlan.downloadSizeBytes !== 0) {
        if (yes) {
          lines.push(
            chalk.yellow(
              `Resolution completed. Downloading ${formatSizeBytes1000(downloadPlan.downloadSizeBytes)}...`,
            ),
          );
        } else {
          lines.push(
            chalk.yellow(
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
