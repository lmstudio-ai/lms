import { Command, Option, type OptionValues } from "@commander-js/extra-typings";
import { search, select } from "@inquirer/prompts";
import { type SimpleLogger, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import {
  type ArtifactDownloadPlan,
  type ArtifactDownloadPlanModelInfo,
  type ArtifactDownloadPlanNode,
  kebabCaseRegex,
  kebabCaseWithDotsRegex,
  type ModelCompatibilityType,
  type ModelDownloadSource,
  type ModelSearchResultDownloadOptionFitEstimation,
} from "@lmstudio/lms-shared-types";
import {
  type ArtifactDownloadPlanner,
  type FuzzyFindStaffPickResult,
  type LMStudioClient,
  type RepositoryDownloadPlannerResolutionPreference,
} from "@lmstudio/sdk";
import chalk from "chalk";
import fuzzy from "fuzzy";
import { askQuestionWithChoices } from "../confirm.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { formatSizeBytes1000, formatSizeBytesWithColor1000 } from "../formatBytes.js";
import { handleDownloadWithProgressBar } from "../handleDownloadWithProgressBar.js";
import { fuzzyHighlightOptions, searchTheme } from "../inquirerTheme.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { runPromptWithExitHandling } from "../prompt.js";
import { createRefinedNumberParser } from "../types/refinedNumber.js";

type GetCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    mlx?: boolean;
    gguf?: boolean;
    limit?: number;
    yes?: boolean;
  };

type ArtifactDownloadPlanModelNode = Extract<ArtifactDownloadPlanNode, { type: "model" }>;
type ArtifactModelSelectionValue = "alreadyOwned" | `download:${number}`;
type ArtifactConfirmationChoice = "Y" | "N" | "E";

type GetCommandTarget =
  | {
      type: "artifact";
      owner: string;
      name: string;
    }
  | {
      type: "model";
      source: ModelDownloadSource;
      displayName: string;
      fileNamePreference?: string;
    }
  | {
      type: "staffPickSearch";
      searchTerm?: string;
    };

interface DownloadPlannerCliOpts {
  yes: boolean;
  resolutionPreference?: Array<RepositoryDownloadPlannerResolutionPreference>;
  compatibilityTypes?: Array<ModelCompatibilityType>;
  requestedQuantName?: string;
}

const getCommand = new Command<[], GetCommandOptions>()
  .name("get")
  .description(text`Search and download local models`)
  .argument(
    "[modelName]",
    text`
      The model to download. If the input is "owner/name", it is treated as an LM Studio Hub
      artifact. If the input is a "https://huggingface.co/owner/repo" URL, it is treated as a
      direct Hugging Face model download. Otherwise, LM Studio searches staff picks only. For
      models that have multiple quantizations, you can specify the quantization by appending it
      with "@". For example, use "llama-3.1-8b@q4_k_m".
    `,
  )
  .option(
    "--mlx",
    text`
      Restrict concrete model resolution to MLX-compatible options. If any of "--mlx" or "--gguf"
      is specified, only matching formats will be considered. Otherwise only options supported by
      your installed LM Runtimes will be considered.
    `,
  )
  .option(
    "--gguf",
    text`
      Restrict concrete model resolution to GGUF-compatible options. If any of "--mlx" or
      "--gguf" is specified, only matching formats will be considered. Otherwise only options
      supported by your installed LM Runtimes will be considered.
    `,
  )
  .addOption(
    new Option("-n, --limit <value>", "Limit the number of model options.").argParser(
      createRefinedNumberParser({ integer: true, min: 1 }),
    ),
  )
  .option(
    "-y, --yes",
    text`
      Automatically approve all prompts. Useful for scripting. If there are multiple
      staff picks matching the search term, the first one will be used. If there are multiple
      download options, the recommended one based on your hardware will be chosen unless a file or
      quantization preference selects something else.
    `,
  );

addCreateClientOptions(getCommand);
addLogLevelOptions(getCommand);

function getRequestedCompatibilityTypes({
  mlx,
  gguf,
}: {
  mlx: boolean;
  gguf: boolean;
}): Array<ModelCompatibilityType> | undefined {
  if (!mlx && !gguf) {
    return undefined;
  }
  const compatibilityTypes: Array<ModelCompatibilityType> = [];
  if (mlx) {
    compatibilityTypes.push("safetensors");
  }
  if (gguf) {
    compatibilityTypes.push("gguf");
  }
  return compatibilityTypes;
}

function splitModelNameAndQuantization(modelName: string | undefined) {
  let normalizedModelName = modelName?.trim();
  let specifiedQuantName: string | undefined;
  if (normalizedModelName === undefined || normalizedModelName === "") {
    return {
      modelNameWithoutQuantization: normalizedModelName,
      specifiedQuantName,
    };
  }

  const splitByAt = normalizedModelName.split("@");
  if (splitByAt.length >= 3) {
    throw new Error("You cannot have more than 2 @'s in the model name argument.");
  }
  normalizedModelName = splitByAt[0]?.trim();
  if (splitByAt.length === 2) {
    specifiedQuantName = splitByAt[1]?.trim();
  }
  return {
    modelNameWithoutQuantization: normalizedModelName,
    specifiedQuantName,
  };
}

function tryParseHuggingFaceUrl(modelName: string): GetCommandTarget | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(modelName);
  } catch {
    return null;
  }

  if (parsedUrl.hostname !== "huggingface.co") {
    return null;
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Only https://huggingface.co URLs are supported.");
  }

  const pathSegments = parsedUrl.pathname.split("/").filter(segment => segment !== "");
  const [user, repo] = pathSegments;
  if (user === undefined || repo === undefined) {
    throw new Error(
      "Invalid Hugging Face model URL. Expected https://huggingface.co/owner/repo[/*].",
    );
  }

  const trailingSegments = pathSegments.slice(2);
  const lastTrailingSegment = trailingSegments[trailingSegments.length - 1];
  const fileNamePreference =
    trailingSegments.length === 0 || lastTrailingSegment === undefined
      ? undefined
      : lastTrailingSegment;
  return {
    type: "model",
    source: {
      type: "huggingface",
      user,
      repo,
    },
    displayName: `${user}/${repo}`,
    fileNamePreference,
  };
}

function getCommandTarget(modelName: string | undefined): GetCommandTarget {
  if (modelName === undefined || modelName === "") {
    return {
      type: "staffPickSearch",
    };
  }

  const huggingFaceUrlTarget = tryParseHuggingFaceUrl(modelName);
  if (huggingFaceUrlTarget !== null) {
    return huggingFaceUrlTarget;
  }

  const pathSegments = modelName.split("/");
  if (pathSegments.length === 2) {
    const [owner, name] = modelName.toLowerCase().split("/");
    return {
      type: "artifact",
      owner,
      name,
    };
  }

  return {
    type: "staffPickSearch",
    searchTerm: modelName,
  };
}

function makeResolutionPreferences({
  fileNamePreference,
  quantNamePreference,
}: {
  fileNamePreference?: string;
  quantNamePreference?: string;
}): Array<RepositoryDownloadPlannerResolutionPreference> | undefined {
  const resolutionPreference: Array<RepositoryDownloadPlannerResolutionPreference> = [];
  if (fileNamePreference !== undefined && fileNamePreference !== "") {
    resolutionPreference.push({
      type: "fileName",
      fileName: fileNamePreference,
    });
  }
  if (quantNamePreference !== undefined && quantNamePreference !== "") {
    resolutionPreference.push({
      type: "quantName",
      quantName: quantNamePreference,
    });
  }
  return resolutionPreference.length === 0 ? undefined : resolutionPreference;
}

getCommand.action(async (modelName, options: GetCommandOptions) => {
  const { mlx = false, gguf = false, limit, yes = false } = options;
  const logger = createLogger(options);
  let modelNameWithoutQuantization: string | undefined;
  let specifiedQuantName: string | undefined;
  try {
    const parsedModelName = splitModelNameAndQuantization(modelName);
    modelNameWithoutQuantization = parsedModelName.modelNameWithoutQuantization;
    specifiedQuantName = parsedModelName.specifiedQuantName;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const compatibilityTypes = getRequestedCompatibilityTypes({ mlx, gguf });
  let target: GetCommandTarget;
  try {
    target = getCommandTarget(modelNameWithoutQuantization);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const requestedQuantName =
    specifiedQuantName === undefined || specifiedQuantName === "" ? undefined : specifiedQuantName;
  await using client = await createClient(logger, options);

  switch (target.type) {
    case "artifact": {
      if (limit !== undefined) {
        logger.error("You cannot use the --limit flag when an exact artifact is specified.");
        process.exit(1);
      }
      if (!kebabCaseRegex.test(target.owner)) {
        logger.error("Invalid artifact owner:", target.owner);
        process.exit(1);
      }
      if (!kebabCaseWithDotsRegex.test(target.name)) {
        logger.error("Invalid artifact name:", target.name);
        process.exit(1);
      }
      await downloadArtifact(client, logger, target.owner, target.name, {
        yes,
        compatibilityTypes,
        requestedQuantName,
        resolutionPreference: makeResolutionPreferences({
          quantNamePreference: requestedQuantName,
        }),
      });
      return;
    }
    case "model": {
      if (limit !== undefined) {
        logger.error("You cannot use the --limit flag with a direct Hugging Face model URL.");
        process.exit(1);
      }
      await downloadModelSource(client, logger, target.source, target.displayName, {
        yes,
        compatibilityTypes,
        requestedQuantName,
        resolutionPreference: makeResolutionPreferences({
          fileNamePreference: target.fileNamePreference,
          quantNamePreference: requestedQuantName,
        }),
      });
      return;
    }
    case "staffPickSearch": {
      if (target.searchTerm !== undefined && target.searchTerm !== "") {
        logger.info("Searching staff picks with the term", chalk.yellow(target.searchTerm));
      }
      const staffPickResults = await client.repository.unstable.fuzzyFindStaffPicks({
        searchTerm: target.searchTerm,
        limit,
      });
      if (staffPickResults.length === 0) {
        logger.error("No staff picks found with the specified search criteria.");
        process.exit(1);
      }

      const exactMatchIndex = staffPickResults.findIndex(result => result.exact);
      let selectedResult: FuzzyFindStaffPickResult;
      if (exactMatchIndex !== -1) {
        selectedResult = staffPickResults[exactMatchIndex];
      } else if (yes) {
        logger.info(
          "Multiple staff picks found. Automatically selecting the first one due to --yes.",
        );
        selectedResult = staffPickResults[0];
      } else {
        logger.info("No exact match found. Please choose a model from the list below.");
        logger.infoWithoutPrefix();
        selectedResult = await askToChooseStaffPick(staffPickResults, 2);
      }

      await downloadArtifact(client, logger, selectedResult.owner, selectedResult.name, {
        yes,
        compatibilityTypes,
        requestedQuantName,
        resolutionPreference: makeResolutionPreferences({
          quantNamePreference: requestedQuantName,
        }),
      });
      return;
    }
    default: {
      const exhaustiveCheck: never = target;
      throw new Error(`Unexpected target: ${exhaustiveCheck}`);
    }
  }
});

async function askToChooseStaffPick(
  staffPicks: Array<FuzzyFindStaffPickResult>,
  additionalRowsToReserve = 0,
): Promise<FuzzyFindStaffPickResult> {
  const modelNames = staffPicks.map(staffPick => `${staffPick.owner}/${staffPick.name}`);
  const pageSize = terminalSize().rows - 4 - additionalRowsToReserve;
  return await runPromptWithExitHandling(() =>
    search<FuzzyFindStaffPickResult>(
      {
        message: "Select a model to download",
        pageSize,
        theme: searchTheme,
        source: async (term: string | undefined, { signal }: { signal: AbortSignal }) => {
          void signal;
          const searchTerm = term ?? "";
          const options = fuzzy.filter(searchTerm, modelNames, fuzzyHighlightOptions);
          return options.map(option => {
            const staffPick = staffPicks[option.index];
            let name: string = "";
            if (staffPick.exact) {
              name += chalk.yellow("[Exact Match] ");
            }
            name += option.string;
            if (staffPick.description !== undefined) {
              const truncated =
                staffPick.description.length > 80
                  ? `${staffPick.description.slice(0, 55)}...`
                  : staffPick.description;
              name += chalk.dim(` — ${truncated}`);
            }
            return {
              name,
              value: staffPick,
              short: option.original,
            };
          });
        },
      },
      { output: process.stderr },
    ),
  );
}
function makeArtifactModelSelectionValue(downloadOptionIndex: number): ArtifactModelSelectionValue {
  return `download:${downloadOptionIndex}` as ArtifactModelSelectionValue;
}

function getSelectedDownloadOptionIndexFromArtifactModelSelectionValue(
  selectionValue: ArtifactModelSelectionValue,
): number | null {
  if (selectionValue === "alreadyOwned") {
    return null;
  }
  return Number.parseInt(selectionValue.slice("download:".length), 10);
}

function artifactPlanModelNodeNeedsSelectionPrompt(modelNode: ArtifactDownloadPlanModelNode) {
  return getArtifactSelectionChoiceCount(modelNode) > 1;
}

function getEditableArtifactPlanModelNodeIndexes(plan: ArtifactDownloadPlan): Array<number> {
  return plan.nodes.flatMap((node, nodeIndex) => {
    if (node.type !== "model" || !artifactPlanModelNodeNeedsSelectionPrompt(node)) {
      return [];
    }
    return [nodeIndex];
  });
}

function shouldShowAlreadyOwnedArtifactSelectionChoice(modelNode: ArtifactDownloadPlanModelNode) {
  if (modelNode.alreadyOwned === undefined) {
    return false;
  }
  return !(modelNode.downloadOptions ?? []).some(
    downloadOption => downloadOption.availability === "downloaded",
  );
}

function getArtifactSelectionChoiceCount(modelNode: ArtifactDownloadPlanModelNode) {
  const downloadOptionCount = (modelNode.downloadOptions ?? []).length;
  const alreadyOwnedChoiceCount = shouldShowAlreadyOwnedArtifactSelectionChoice(modelNode) ? 1 : 0;
  return downloadOptionCount + alreadyOwnedChoiceCount;
}

function getDefaultArtifactModelSelectionValue(
  modelNode: ArtifactDownloadPlanModelNode,
): ArtifactModelSelectionValue {
  if (
    modelNode.selectedDownloadOptionIndex !== undefined &&
    modelNode.selectedDownloadOptionIndex !== null
  ) {
    return makeArtifactModelSelectionValue(modelNode.selectedDownloadOptionIndex);
  }
  if (shouldShowAlreadyOwnedArtifactSelectionChoice(modelNode)) {
    return "alreadyOwned";
  }
  const firstDownloadedOptionIndex = (modelNode.downloadOptions ?? []).findIndex(
    downloadOption => downloadOption.availability === "downloaded",
  );
  if (firstDownloadedOptionIndex !== -1) {
    return makeArtifactModelSelectionValue(firstDownloadedOptionIndex);
  }
  if (
    modelNode.recommendedDownloadOptionIndex !== undefined &&
    modelNode.recommendedDownloadOptionIndex !== null
  ) {
    return makeArtifactModelSelectionValue(modelNode.recommendedDownloadOptionIndex);
  }
  return makeArtifactModelSelectionValue(0);
}

function formatCompatibilityTypeSuffix(compatibilityType: ModelCompatibilityType) {
  if (compatibilityType === "gguf") {
    return "[GGUF]";
  }
  if (compatibilityType === "safetensors") {
    return "[MLX]";
  }
  return "";
}

function formatModelDisplayNameWithCompatibility(model: {
  displayName: string;
  compatibilityType: ModelCompatibilityType;
}) {
  const compatibilityTypeSuffix = formatCompatibilityTypeSuffix(model.compatibilityType);
  if (compatibilityTypeSuffix === "") {
    return model.displayName;
  }
  return `${model.displayName} ${compatibilityTypeSuffix}`;
}

interface ArtifactDownloadOptionChoiceData {
  value: ArtifactModelSelectionValue;
  short: string;
  quantText: string;
  sizeText: string;
  nameText: string;
  tags: Array<string>;
}

function createArtifactDownloadOptionTag(
  type: "recommended" | "downloaded" | "downloading" | ModelSearchResultDownloadOptionFitEstimation,
) {
  switch (type) {
    case "willNotFit":
      return chalk.white.bgRed(" Won't Fit ");
    case "fitWithoutGPU":
      return chalk.black.bgGreen(" CPU Fit ");
    case "partialGPUOffload":
      return chalk.black.bgYellow(" Partial GPU ");
    case "fullGPUOffload":
      return chalk.black.bgGreen(" Full GPU ");
    case "recommended":
      return chalk.black.bgYellow(" ★ Recommended ");
    case "downloaded":
      return chalk.black.bgGreen(" ✓ Downloaded ");
    case "downloading":
      return chalk.black.bgBlueBright(" ⌛ Downloading ");
  }
}

function createArtifactDownloadOptionChoiceData(modelNode: ArtifactDownloadPlanModelNode) {
  const choiceData: Array<ArtifactDownloadOptionChoiceData> = [];
  if (shouldShowAlreadyOwnedArtifactSelectionChoice(modelNode)) {
    choiceData.push({
      value: "alreadyOwned",
      short: modelToString(modelNode.alreadyOwned!),
      quantText: modelNode.alreadyOwned!.quantName ?? "",
      sizeText: formatSizeBytes1000(modelNode.alreadyOwned!.sizeBytes),
      nameText: formatModelDisplayNameWithCompatibility(modelNode.alreadyOwned!),
      tags: [createArtifactDownloadOptionTag("downloaded")],
    });
  }
  for (const [downloadOptionIndex, downloadOption] of (modelNode.downloadOptions ?? []).entries()) {
    const tags: Array<string> = [createArtifactDownloadOptionTag(downloadOption.fitEstimation)];
    if (downloadOption.recommended === true) {
      tags.push(createArtifactDownloadOptionTag("recommended"));
    }
    if (downloadOption.availability === "downloaded") {
      tags.push(createArtifactDownloadOptionTag("downloaded"));
    } else if (downloadOption.availability === "downloading") {
      tags.push(createArtifactDownloadOptionTag("downloading"));
    }
    choiceData.push({
      value: makeArtifactModelSelectionValue(downloadOptionIndex),
      short: modelToString(downloadOption),
      quantText: downloadOption.quantName ?? "",
      sizeText: formatSizeBytes1000(downloadOption.sizeBytes),
      nameText: formatModelDisplayNameWithCompatibility(downloadOption),
      tags,
    });
  }
  return choiceData;
}

async function askToChooseArtifactDownloadSelection(
  modelNode: ArtifactDownloadPlanModelNode,
  pageSize: number,
): Promise<ArtifactModelSelectionValue> {
  console.info(chalk.dim("! Use the arrow keys to navigate, and press enter to select."));

  const choiceData = createArtifactDownloadOptionChoiceData(modelNode);
  const quantColumnWidth = Math.max(0, ...choiceData.map(choice => choice.quantText.length));
  const sizeColumnWidth = Math.max(0, ...choiceData.map(choice => choice.sizeText.length));
  const nameColumnWidth = Math.max(0, ...choiceData.map(choice => choice.nameText.length));
  const choices = choiceData.map(choice => {
    let name = "";
    if (quantColumnWidth > 0) {
      name += `${choice.quantText.padEnd(quantColumnWidth)}  `;
    }
    name += `${choice.sizeText.padStart(sizeColumnWidth)}  `;
    name += chalk.dim(choice.nameText.padEnd(nameColumnWidth));
    if (choice.tags.length > 0) {
      name += `  ${choice.tags.join(" ")}`;
    }
    return {
      name,
      value: choice.value,
      short: choice.short,
    };
  });

  return await runPromptWithExitHandling(() =>
    select<ArtifactModelSelectionValue>(
      {
        message: chalk.green(`Select a concrete model for ${modelNode.dependencyLabel}`),
        loop: false,
        pageSize,
        default: getDefaultArtifactModelSelectionValue(modelNode),
        choices,
      },
      { output: process.stderr },
    ),
  );
}

async function applyArtifactModelSelection(
  downloadPlanner: ArtifactDownloadPlanner,
  nodeIndex: number,
  currentPlanNode: ArtifactDownloadPlanModelNode,
  selectionValue: ArtifactModelSelectionValue,
) {
  const selectedDownloadOptionIndex =
    getSelectedDownloadOptionIndexFromArtifactModelSelectionValue(selectionValue);
  if (selectedDownloadOptionIndex === null) {
    if (currentPlanNode.selectedDownloadOptionIndex === null) {
      return false;
    }
    await downloadPlanner.selectAlreadyOwnedModel({ nodeIndex });
    return true;
  }
  if (currentPlanNode.selectedDownloadOptionIndex === selectedDownloadOptionIndex) {
    return false;
  }
  await downloadPlanner.selectModelDownloadOption({
    nodeIndex,
    downloadOptionIndex: selectedDownloadOptionIndex,
  });
  return true;
}

function getArtifactSelectionPromptPageSize(renderedLineCount: number) {
  return Math.max(5, terminalSize().rows - renderedLineCount - 4);
}

async function openArtifactDownloadSelectionEditor(
  downloadPlanner: ArtifactDownloadPlanner,
): Promise<boolean> {
  let selectionChanged = false;
  const editableNodeIndexes = getEditableArtifactPlanModelNodeIndexes(downloadPlanner.getPlan());
  for (const nodeIndex of editableNodeIndexes) {
    const refreshedPlan = downloadPlanner.getPlan();
    const currentPlanNode = refreshedPlan.nodes[nodeIndex];
    if (currentPlanNode === undefined || currentPlanNode.type !== "model") {
      continue;
    }

    const renderedLineCount = printArtifactDownloadPlanScreen(refreshedPlan, {
      highlightedNodeIndex: nodeIndex,
    });
    const selectionValue = await askToChooseArtifactDownloadSelection(
      currentPlanNode,
      getArtifactSelectionPromptPageSize(renderedLineCount),
    );
    const changed = await applyArtifactModelSelection(
      downloadPlanner,
      nodeIndex,
      currentPlanNode,
      selectionValue,
    );
    if (changed) {
      selectionChanged = true;
    }
  }
  printArtifactDownloadPlanScreen(downloadPlanner.getPlan(), { clearScreen: true });
  return selectionChanged;
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const tableVerticalLine = chalk.dim("│");
const tableBranch = chalk.dim("├");
const tableLastBranch = chalk.dim("└");
const tableHorizontalLine = chalk.dim("─");

function modelToString(model: ArtifactDownloadPlanModelInfo) {
  let result = model.displayName;
  if (model.quantName !== undefined) {
    result += ` ${model.quantName}`;
  }
  const compatibilityTypeSuffix = formatCompatibilityTypeSuffix(model.compatibilityType);
  if (compatibilityTypeSuffix !== "") {
    result += ` ${compatibilityTypeSuffix}`;
  }
  return result;
}

const toDownloadText = chalk.yellow("↓ To download:");

interface ArtifactPlanScreenOpts {
  clearScreen?: boolean;
  highlightedNodeIndex?: number;
  footerLines?: Array<string>;
}

function artifactDownloadPlanToString(
  plan: ArtifactDownloadPlan,
  lines: Array<string>,
  spinnerFrame: number,
  currentNodeIndex = 0,
  selfPrefix = "",
  subSequentPrefix = "",
  highlightedNodeIndex?: number,
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
          message = `${spinnerFrames[(spinnerFrame + currentNodeIndex) % spinnerFrames.length]} ${artifactName} ${chalk.dim("- Resolving...")}`;
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
      if (highlightedNodeIndex === currentNodeIndex) {
        message += " " + chalk.yellowBright("[Editing]");
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
          highlightedNodeIndex,
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
          message = `${spinnerFrames[(spinnerFrame + currentNodeIndex) % spinnerFrames.length]} ${chalk.dim(`Finding options based on your system... (${node.resolvedSources}/${node.totalSources})`)}`;
          break;
        }
        case "satisfied": {
          const satisfiedModel = node.selected ?? node.alreadyOwned;
          if (satisfiedModel === undefined) {
            message = `${chalk.green("✓ Satisfied")} Unknown`;
          } else {
            message = `${chalk.green("✓ Satisfied")} ${modelToString(satisfiedModel)}`;
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
      if (highlightedNodeIndex === currentNodeIndex) {
        message = chalk.yellowBright("▶ ") + message + " " + chalk.yellowBright("[Editing]");
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

function buildArtifactDownloadPlanLines(
  plan: ArtifactDownloadPlan,
  isFinished: boolean,
  highlightedNodeIndex?: number,
  yes = false,
  footerLines: Array<string> = [],
) {
  const lines: Array<string> = [""];
  const spinnerFrame = Math.floor(Date.now() / 100) % spinnerFrames.length;
  artifactDownloadPlanToString(plan, lines, spinnerFrame, 0, "   ", "  ", highlightedNodeIndex);
  lines.push("");

  if (isFinished) {
    if (plan.downloadSizeBytes !== 0) {
      if (yes) {
        lines.push(
          chalk.yellow(
            `Resolution completed. Downloading ${formatSizeBytes1000(plan.downloadSizeBytes)}...`,
          ),
        );
      } else {
        lines.push(
          chalk.yellow(`About to download ${formatSizeBytes1000(plan.downloadSizeBytes)}.`),
        );
      }
    }
  } else if (plan.downloadSizeBytes > 0) {
    lines.push(
      chalk.dim(
        spinnerFrames[spinnerFrame] +
          ` Resolving download plan... (${formatSizeBytes1000(plan.downloadSizeBytes)})`,
      ),
    );
  } else {
    lines.push(
      chalk.dim(
        spinnerFrames[(spinnerFrame + 5) % spinnerFrames.length] + " Resolving download plan...",
      ),
    );
  }

  if (footerLines.length > 0) {
    lines.push("");
    lines.push(...footerLines);
  }

  return lines;
}

function printArtifactDownloadPlanScreen(
  plan: ArtifactDownloadPlan,
  { clearScreen = true, highlightedNodeIndex, footerLines = [] }: ArtifactPlanScreenOpts = {},
) {
  if (clearScreen) {
    console.clear();
  }
  const lines = buildArtifactDownloadPlanLines(
    plan,
    true,
    highlightedNodeIndex,
    false,
    footerLines,
  );
  for (const line of lines) {
    process.stdout.write(line + "\n");
  }
  process.stdout.write("\n");
  return lines.length + 1;
}

type DownloadPlanRequest =
  | {
      type: "artifact";
      owner: string;
      name: string;
    }
  | {
      type: "model";
      source: ModelDownloadSource;
      displayName: string;
    };

function normalizeDownloadPlannerCliOpts(
  yesOrOpts: boolean | DownloadPlannerCliOpts,
): DownloadPlannerCliOpts {
  if (typeof yesOrOpts === "boolean") {
    return {
      yes: yesOrOpts,
    };
  }
  return yesOrOpts;
}

function makeInitialDownloadPlan(request: DownloadPlanRequest): ArtifactDownloadPlan {
  if (request.type === "artifact") {
    return {
      nodes: [
        {
          type: "artifact",
          owner: request.owner,
          name: request.name,
          state: "pending",
          dependencyNodes: [],
        },
      ],
      downloadSizeBytes: 0,
      version: 0,
    };
  }

  return {
    nodes: [
      {
        type: "model",
        state: "pending",
        dependencyLabel: request.displayName,
      },
    ],
    downloadSizeBytes: 0,
    version: 0,
  };
}

function createDownloadPlanner(
  client: LMStudioClient,
  request: DownloadPlanRequest,
  opts: DownloadPlannerCliOpts,
  onPlanUpdated: (newPlan: ArtifactDownloadPlan) => void,
) {
  if (request.type === "artifact") {
    return client.repository.createArtifactDownloadPlanner({
      owner: request.owner,
      name: request.name,
      compatibilityTypes: opts.compatibilityTypes,
      resolutionPreference: opts.resolutionPreference,
      onPlanUpdated,
    });
  }

  return client.repository.createModelDownloadPlanner({
    source: request.source,
    compatibilityTypes: opts.compatibilityTypes,
    resolutionPreference: opts.resolutionPreference,
    onPlanUpdated,
  });
}

function planContainsRequestedQuant(
  plan: ArtifactDownloadPlan,
  requestedQuantName: string,
): boolean {
  const normalizedRequestedQuantName = requestedQuantName.toLowerCase();
  return plan.nodes.some(node => {
    if (node.type !== "model") {
      return false;
    }
    if (
      node.alreadyOwned?.quantName !== undefined &&
      node.alreadyOwned.quantName.toLowerCase() === normalizedRequestedQuantName
    ) {
      return true;
    }
    return (node.downloadOptions ?? []).some(downloadOption => {
      return (
        downloadOption.quantName !== undefined &&
        downloadOption.quantName.toLowerCase() === normalizedRequestedQuantName
      );
    });
  });
}

function getAvailableQuantNames(plan: ArtifactDownloadPlan): Array<string> {
  const availableQuantNames = new Set<string>();
  for (const node of plan.nodes) {
    if (node.type !== "model") {
      continue;
    }
    if (node.alreadyOwned?.quantName !== undefined && node.alreadyOwned.quantName !== "") {
      availableQuantNames.add(node.alreadyOwned.quantName);
    }
    for (const downloadOption of node.downloadOptions ?? []) {
      if (downloadOption.quantName !== undefined && downloadOption.quantName !== "") {
        availableQuantNames.add(downloadOption.quantName);
      }
    }
  }
  return [...availableQuantNames].sort((leftValue, rightValue) => {
    return leftValue.localeCompare(rightValue);
  });
}

async function maybeHandleMissingRequestedQuant({
  downloadPlan,
  downloadPlanner,
  logger,
  requestedQuantName,
  yes,
}: {
  downloadPlan: ArtifactDownloadPlan;
  downloadPlanner: ArtifactDownloadPlanner;
  logger: SimpleLogger;
  requestedQuantName: string | undefined;
  yes: boolean;
}) {
  if (
    requestedQuantName === undefined ||
    requestedQuantName === "" ||
    planContainsRequestedQuant(downloadPlan, requestedQuantName)
  ) {
    return;
  }

  const availableQuantNames = getAvailableQuantNames(downloadPlan);
  if (yes) {
    logger.error(
      `Cannot find a concrete model with quantization "${requestedQuantName}" in this plan.`,
    );
    if (availableQuantNames.length > 0) {
      logger.error("Available quantizations:");
      for (const quantName of availableQuantNames) {
        logger.error(`- ${quantName}`);
      }
    }
    process.exit(1);
  }

  logger.warnText`
    Cannot find a concrete model with quantization "${requestedQuantName}". Please choose one from
    the resolved options.
  `;
  await openArtifactDownloadSelectionEditor(downloadPlanner);
}

async function downloadWithPlanner(
  client: LMStudioClient,
  logger: SimpleLogger,
  request: DownloadPlanRequest,
  yesOrOpts: boolean | DownloadPlannerCliOpts,
) {
  const opts = normalizeDownloadPlannerCliOpts(yesOrOpts);
  const { yes, requestedQuantName } = opts;
  let downloadPlan = makeInitialDownloadPlan(request);
  let linesToClear: number = 0;
  let shouldRenderPlanUpdates = true;
  const reprintDownloadPlan = (isFinished: boolean) => {
    // Check if we can move the cursor up (Not available in non TTY environments)
    if (process.stdout.moveCursor !== undefined) {
      // Move cursor up by lastLines
      process.stdout.moveCursor(0, -linesToClear);
    }
    const lines = buildArtifactDownloadPlanLines(downloadPlan, isFinished, undefined, yes);
    linesToClear = Math.max(lines.length, linesToClear);
    for (const line of lines) {
      process.stdout.write("\r" + line + "\x1b[0K\n");
    }
  };
  process.stdout.write("\x1B[?25l");
  let autoReprintInterval: NodeJS.Timeout | undefined = undefined;
  using downloadPlanner = createDownloadPlanner(client, request, opts, newPlan => {
    downloadPlan = newPlan;
    if (shouldRenderPlanUpdates) {
      reprintDownloadPlan(false);
    }
  });
  try {
    reprintDownloadPlan(false);
    autoReprintInterval = setInterval(() => {
      reprintDownloadPlan(false);
    }, 50);
    await downloadPlanner.untilReady();
    downloadPlan = downloadPlanner.getPlan();
    shouldRenderPlanUpdates = false;
    reprintDownloadPlan(true);
  } finally {
    process.stdout.write("\x1B[?25h");
    if (autoReprintInterval !== undefined) {
      clearInterval(autoReprintInterval);
    }
  }

  await maybeHandleMissingRequestedQuant({
    downloadPlan,
    downloadPlanner,
    logger,
    requestedQuantName,
    yes,
  });
  downloadPlan = downloadPlanner.getPlan();

  if (yes && downloadPlan.downloadSizeBytes === 0) {
    process.exit(0);
  }
  if (!yes) {
    while (true) {
      downloadPlan = downloadPlanner.getPlan();
      const editableNodeIndexes = getEditableArtifactPlanModelNodeIndexes(downloadPlan);
      if (downloadPlan.downloadSizeBytes === 0 && editableNodeIndexes.length === 0) {
        process.exit(0);
      }

      const continueChoices =
        editableNodeIndexes.length === 0 ? (["Y", "N"] as const) : (["Y", "N", "E"] as const);
      const confirmationChoice = await askQuestionWithChoices<ArtifactConfirmationChoice>(
        "Continue?",
        continueChoices as readonly [
          ArtifactConfirmationChoice,
          ...Array<ArtifactConfirmationChoice>,
        ],
        { choiceLabel: "Y/N, or E to select quantization" },
      );
      if (confirmationChoice === null || confirmationChoice === "N") {
        process.exit(1);
      }
      if (confirmationChoice === "Y") {
        break;
      }

      await openArtifactDownloadSelectionEditor(downloadPlanner);
    }
  }

  downloadPlan = downloadPlanner.getPlan();
  if (downloadPlan.downloadSizeBytes === 0) {
    process.exit(0);
  }

  // Duplicated logic for downloading artifact. Will be cleaned up when we move to artifact download
  // only.

  await handleDownloadWithProgressBar(logger, async opts => {
    return await downloadPlanner.download(opts);
  });
}

export async function downloadArtifact(
  client: LMStudioClient,
  logger: SimpleLogger,
  owner: string,
  name: string,
  yesOrOpts: boolean | DownloadPlannerCliOpts,
) {
  return await downloadWithPlanner(
    client,
    logger,
    {
      type: "artifact",
      owner,
      name,
    },
    yesOrOpts,
  );
}

async function downloadModelSource(
  client: LMStudioClient,
  logger: SimpleLogger,
  source: ModelDownloadSource,
  displayName: string,
  opts: DownloadPlannerCliOpts,
) {
  return await downloadWithPlanner(
    client,
    logger,
    {
      type: "model",
      source,
      displayName,
    },
    opts,
  );
}

export const get = getCommand;
