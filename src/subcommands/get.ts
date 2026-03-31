import { Command, type OptionValues } from "@commander-js/extra-typings";
import { search, select } from "@inquirer/prompts";
import { type SimpleLogger, text } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import {
  type ArtifactDownloadPlan,
  type ArtifactDownloadPlanModelInfo,
  type ArtifactDownloadPlanNode,
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
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { formatSizeBytes1000, formatSizeBytesWithColor1000 } from "../formatBytes.js";
import { handleDownloadWithProgressBar } from "../handleDownloadWithProgressBar.js";
import { fuzzyHighlightOptions, searchTheme } from "../inquirerTheme.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { runPromptWithExitHandling } from "../prompt.js";
import { tryParseLmStudioArtifactUrl } from "./parseLmStudioArtifactUrl.js";

type GetCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    mlx?: boolean;
    gguf?: boolean;
    select?: boolean;
    yes?: boolean;
  };

type ArtifactDownloadPlanModelNode = Extract<ArtifactDownloadPlanNode, { type: "model" }>;
type ArtifactModelSelectionValue = "alreadyOwned" | `download:${number}`;
type DownloadConfirmationAction = "download" | "selectVariants" | "cancel";

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

interface ParsedHuggingFaceTarget {
  source: ModelDownloadSource;
  displayName: string;
  fileNamePreference?: string;
}

interface ResolvedGetRequest {
  request: DownloadPlanRequest;
  commandTarget: string;
  fileNamePreference?: string;
}

interface DownloadPlannerCliOpts {
  yes: boolean;
  select?: boolean;
  resolutionPreference?: Array<RepositoryDownloadPlannerResolutionPreference>;
  compatibilityTypes?: Array<ModelCompatibilityType>;
  requestedQuantName?: string;
  commandTarget?: string;
  loadTarget?: string;
}

const getCommand = new Command<[], GetCommandOptions>()
  .name("get")
  .description(text`Search and download local models or presets`)
  .argument(
    "[name]",
    text`
      The model to download, for example "openai/gpt-oss-20b". If you want to download a specific
      quantization of a model, you can append the quantization name with "@", for example
      "qwen/qwen3.5-9b@q8_0". If you wish to download from Hugging Face directly, use the full
      URL of the model.
    `,
  )
  .option(
    "--mlx",
    text`
      Restrict model resolution to MLX-compatible options. If any of "--mlx" or "--gguf" is
      specified, only matching formats will be considered. Otherwise only options supported by your
      system will be considered.
    `,
  )
  .option(
    "--gguf",
    text`
      Restrict model resolution to GGUF-compatible options. If any of "--mlx" or "--gguf" is
      specified, only matching formats will be considered. Otherwise only options supported by your
      system will be considered.
    `,
  )
  .option(
    "-y, --yes",
    text`
      Automatically approve all prompts. Useful for scripting. If there are multiple
      staff picks matching the search term, the first one will be used. If there are multiple
      download options, the preselected option based on your hardware and preferences will be used.
    `,
  )
  .option(
    "--select",
    text`
      Open variant selection before downloading. Useful if the default variant is already
      downloaded and you want to choose a different one.
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

function tryParseHuggingFaceUrl(modelName: string): ParsedHuggingFaceTarget | null {
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
    source: {
      type: "huggingface",
      user,
      repo,
    },
    displayName: `${user}/${repo}`,
    fileNamePreference,
  };
}

function tryParseArtifactIdentifier(
  modelName: string,
): Extract<DownloadPlanRequest, { type: "artifact" }> | null {
  const pathSegments = modelName.split("/");
  if (pathSegments.length !== 2) {
    return null;
  }

  const [owner, name] = pathSegments;
  if (owner === undefined || owner === "" || name === undefined || name === "") {
    return null;
  }

  return {
    type: "artifact",
    owner: owner.toLowerCase(),
    name: name.toLowerCase(),
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

async function resolveStaffPickDownloadRequest({
  client,
  logger,
  searchTerm,
  yes,
}: {
  client: LMStudioClient;
  logger: SimpleLogger;
  searchTerm: string | undefined;
  yes: boolean;
}): Promise<Extract<DownloadPlanRequest, { type: "artifact" }>> {
  if (searchTerm !== undefined && searchTerm !== "") {
    logger.info("Searching staff picks with the term", chalk.yellow(searchTerm));
  }

  const staffPickResults = await client.repository.unstable.fuzzyFindStaffPicks({
    searchTerm,
  });
  if (staffPickResults.length === 0) {
    throw new Error("No staff picks found with the specified search criteria.");
  }

  const exactMatchIndex = staffPickResults.findIndex(result => result.exact);
  let selectedResult: FuzzyFindStaffPickResult;
  if (exactMatchIndex !== -1) {
    selectedResult = staffPickResults[exactMatchIndex];
  } else if (yes) {
    logger.info("Multiple staff picks found. Automatically selecting the first one due to --yes.");
    selectedResult = staffPickResults[0];
  } else {
    logger.info("No exact match found. Please choose a model from the list below.");
    logger.infoWithoutPrefix();
    selectedResult = await askToChooseStaffPick(staffPickResults, 2);
  }

  return {
    type: "artifact",
    owner: selectedResult.owner,
    name: selectedResult.name,
  };
}

async function resolveGetRequest({
  client,
  logger,
  modelName,
  yes,
}: {
  client: LMStudioClient;
  logger: SimpleLogger;
  modelName: string | undefined;
  yes: boolean;
}): Promise<ResolvedGetRequest> {
  if (modelName !== undefined && modelName !== "") {
    const huggingFaceTarget = tryParseHuggingFaceUrl(modelName);
    if (huggingFaceTarget !== null) {
      return {
        request: {
          type: "model",
          source: huggingFaceTarget.source,
          displayName: huggingFaceTarget.displayName,
        },
        commandTarget: modelName,
        fileNamePreference: huggingFaceTarget.fileNamePreference,
      };
    }

    const lmStudioArtifactTarget = tryParseLmStudioArtifactUrl(modelName);
    if (lmStudioArtifactTarget !== null) {
      return {
        request: {
          type: "artifact",
          owner: lmStudioArtifactTarget.owner,
          name: lmStudioArtifactTarget.name,
        },
        commandTarget: `${lmStudioArtifactTarget.owner}/${lmStudioArtifactTarget.name}`,
      };
    }

    const artifactRequest = tryParseArtifactIdentifier(modelName);
    if (artifactRequest !== null) {
      return {
        request: artifactRequest,
        commandTarget: `${artifactRequest.owner}/${artifactRequest.name}`,
      };
    }
  }

  const staffPickRequest = await resolveStaffPickDownloadRequest({
    client,
    logger,
    searchTerm: modelName,
    yes,
  });
  return {
    request: staffPickRequest,
    commandTarget: `${staffPickRequest.owner}/${staffPickRequest.name}`,
  };
}

getCommand.action(async (modelName, options: GetCommandOptions) => {
  const { mlx = false, gguf = false, select = false, yes = false } = options;
  const logger = createLogger(options);
  try {
    if (select && yes) {
      throw new Error("The --select flag cannot be used with --yes.");
    }
    if (select && process.stdin.isTTY !== true) {
      throw new Error("The --select flag requires an interactive terminal.");
    }

    const { modelNameWithoutQuantization, specifiedQuantName } =
      splitModelNameAndQuantization(modelName);
    const requestedQuantName =
      specifiedQuantName === undefined || specifiedQuantName === ""
        ? undefined
        : specifiedQuantName;
    const compatibilityTypes = getRequestedCompatibilityTypes({ mlx, gguf });

    await using client = await createClient(logger, options);
    const resolvedGetRequest = await resolveGetRequest({
      client,
      logger,
      modelName: modelNameWithoutQuantization,
      yes,
    });

    await downloadWithPlanner(client, logger, resolvedGetRequest.request, {
      yes,
      select,
      compatibilityTypes,
      requestedQuantName,
      commandTarget: resolvedGetRequest.commandTarget,
      loadTarget:
        resolvedGetRequest.request.type === "model"
          ? resolvedGetRequest.request.displayName
          : undefined,
      resolutionPreference: makeResolutionPreferences({
        fileNamePreference: resolvedGetRequest.fileNamePreference,
        quantNamePreference: requestedQuantName,
      }),
    });
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
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
    modelNode.recommendedDownloadOptionIndex !== null &&
    modelNode.downloadOptions?.[modelNode.recommendedDownloadOptionIndex]?.fitEstimation !==
      "willNotFit"
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
    if (downloadOption.availability === "downloaded") {
      tags.push(createArtifactDownloadOptionTag("downloaded"));
    } else if (downloadOption.availability === "downloading") {
      tags.push(createArtifactDownloadOptionTag("downloading"));
    }
    if (downloadOption.recommended === true && downloadOption.fitEstimation !== "willNotFit") {
      tags.push(createArtifactDownloadOptionTag("recommended"));
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
        message: chalk.green(`Select a variant`),
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

interface OpenArtifactDownloadSelectionEditorOpts {
  clearScreenBeforeSelection?: boolean;
  clearScreenAfterSelection?: boolean;
}

async function openArtifactDownloadSelectionEditor(
  downloadPlanner: ArtifactDownloadPlanner,
  {
    clearScreenBeforeSelection = true,
    clearScreenAfterSelection = true,
  }: OpenArtifactDownloadSelectionEditorOpts = {},
): Promise<boolean> {
  let selectionChanged = false;
  const editableNodeIndexes = getEditableArtifactPlanModelNodeIndexes(downloadPlanner.getPlan());
  const hasSingleEditableNode = editableNodeIndexes.length === 1;
  for (const nodeIndex of editableNodeIndexes) {
    const refreshedPlan = downloadPlanner.getPlan();
    const currentPlanNode = refreshedPlan.nodes[nodeIndex];
    if (currentPlanNode === undefined || currentPlanNode.type !== "model") {
      continue;
    }

    const renderedLineCount = hasSingleEditableNode
      ? buildArtifactDownloadPlanLines(refreshedPlan, true, undefined, false).length + 1
      : printArtifactDownloadPlanScreen(refreshedPlan, {
          clearScreen: clearScreenBeforeSelection,
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
  printArtifactDownloadPlanScreen(downloadPlanner.getPlan(), {
    clearScreen: hasSingleEditableNode ? false : clearScreenAfterSelection,
  });
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
) {
  const lines: Array<string> = [""];
  const spinnerFrame = Math.floor(Date.now() / 100) % spinnerFrames.length;
  artifactDownloadPlanToString(plan, lines, spinnerFrame, 0, "   ", "  ", highlightedNodeIndex);
  lines.push("");

  if (isFinished) {
    if (plan.downloadAction === "attachToExistingDownload") {
      lines.push(chalk.yellow("This download is already in progress."));
    } else if (plan.downloadSizeBytes !== 0) {
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

  return lines;
}

function printArtifactDownloadPlanScreen(
  plan: ArtifactDownloadPlan,
  { clearScreen = true, highlightedNodeIndex }: ArtifactPlanScreenOpts = {},
) {
  if (clearScreen) {
    console.clear();
  }
  const lines = buildArtifactDownloadPlanLines(plan, true, highlightedNodeIndex, false);
  for (const line of lines) {
    process.stdout.write(line + "\n");
  }
  process.stdout.write("\n");
  return lines.length + 1;
}

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

function getRequestCommandTarget(
  request: DownloadPlanRequest,
  commandTarget: string | undefined,
): string {
  if (commandTarget !== undefined && commandTarget !== "") {
    return commandTarget;
  }
  if (request.type === "artifact") {
    return `${request.owner}/${request.name}`;
  }
  return request.displayName;
}

function getRequestLoadTarget(
  request: DownloadPlanRequest,
  loadTarget: string | undefined,
): string {
  if (loadTarget !== undefined && loadTarget !== "") {
    return loadTarget;
  }
  if (request.type === "artifact") {
    return `${request.owner}/${request.name}`;
  }
  return request.displayName;
}

function quoteCommandArgument(argumentValue: string): string {
  if (argumentValue.includes(" ") || argumentValue.includes('"')) {
    return JSON.stringify(argumentValue);
  }
  return argumentValue;
}

function requestRefersToModel(plan: ArtifactDownloadPlan, request: DownloadPlanRequest): boolean {
  if (request.type === "model") {
    return true;
  }
  const rootNode = plan.nodes[0];
  return rootNode?.type === "artifact" && rootNode.artifactType === "model";
}

function maybeExitIfNothingToDownload({
  logger,
  request,
  downloadPlan,
  commandTarget,
  loadTarget,
  showSelectHint,
}: {
  logger: SimpleLogger;
  request: DownloadPlanRequest;
  downloadPlan: ArtifactDownloadPlan;
  commandTarget: string;
  loadTarget: string;
  showSelectHint: boolean;
}) {
  if (downloadPlan.downloadAction !== "none") {
    return;
  }

  if (requestRefersToModel(downloadPlan, request)) {
    logger.infoWithoutPrefix(
      text`
        Model already downloaded. To use, run:
        ${chalk.yellowBright(`lms load ${quoteCommandArgument(loadTarget)}`)}
      `,
    );
  } else {
    logger.infoWithoutPrefix("Everything is already downloaded");
  }

  if (showSelectHint) {
    logger.infoWithoutPrefix(
      text`
        If you wish to download a variant, run:
        ${chalk.yellowBright(`lms get ${quoteCommandArgument(commandTarget)} --select`)}
      `,
    );
  }

  process.exit(0);
}

async function askToChooseDownloadAction({
  canSelectVariants,
  downloadAction,
}: {
  canSelectVariants: boolean;
  downloadAction: ArtifactDownloadPlan["downloadAction"];
}): Promise<DownloadConfirmationAction> {
  const message =
    downloadAction === "attachToExistingDownload" ? "Follow the download?" : "Start download?";
  const choices: Array<{
    name: string;
    value: DownloadConfirmationAction;
    short: string;
  }> = [
    {
      name: `Yes`,
      value: "download",
      short: "yes",
    },
    {
      name: "No",
      value: "cancel",
      short: "no",
    },
  ];
  if (canSelectVariants) {
    choices.push({
      name: "Change variant selection",
      value: "selectVariants",
      short: "change variant selection",
    });
  }
  console.info();
  return await runPromptWithExitHandling(() =>
    select<DownloadConfirmationAction>(
      {
        message,
        loop: false,
        pageSize: choices.length,
        choices,
      },
      { output: process.stderr },
    ),
  );
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
      downloadAction: "none",
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
    downloadAction: "none",
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

function planHasPreselectedRequestedQuant(
  plan: ArtifactDownloadPlan,
  requestedQuantName: string,
): boolean {
  const normalizedRequestedQuantName = requestedQuantName.toLowerCase();
  return plan.nodes.some(node => {
    if (node.type !== "model") {
      return false;
    }

    const preselectedModel = node.selected !== undefined ? node.selected : node.alreadyOwned;
    return (
      preselectedModel?.quantName !== undefined &&
      preselectedModel.quantName.toLowerCase() === normalizedRequestedQuantName
    );
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
}): Promise<boolean> {
  if (
    requestedQuantName === undefined ||
    requestedQuantName === "" ||
    planHasPreselectedRequestedQuant(downloadPlan, requestedQuantName)
  ) {
    return false;
  }

  const editableNodeIndexes = getEditableArtifactPlanModelNodeIndexes(downloadPlan);
  if (yes || editableNodeIndexes.length === 0) {
    logger.error(`Cannot find variant ${requestedQuantName}.`);
    process.exit(1);
  }

  logger.infoWithoutPrefix(
    chalk.red(`Cannot find variant ${requestedQuantName}, please select one from below.`),
  );
  await openArtifactDownloadSelectionEditor(downloadPlanner, {
    clearScreenBeforeSelection: false,
    clearScreenAfterSelection: false,
  });
  return true;
}

async function downloadWithPlanner(
  client: LMStudioClient,
  logger: SimpleLogger,
  request: DownloadPlanRequest,
  yesOrOpts: boolean | DownloadPlannerCliOpts,
) {
  const opts = normalizeDownloadPlannerCliOpts(yesOrOpts);
  const { yes, requestedQuantName, select = false } = opts;
  const commandTarget = getRequestCommandTarget(request, opts.commandTarget);
  const loadTarget = getRequestLoadTarget(request, opts.loadTarget);
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

  let hasOpenedVariantSelection = await maybeHandleMissingRequestedQuant({
    downloadPlan,
    downloadPlanner,
    logger,
    requestedQuantName,
    yes,
  });
  downloadPlan = downloadPlanner.getPlan();

  if (select && !hasOpenedVariantSelection) {
    const editableNodeIndexes = getEditableArtifactPlanModelNodeIndexes(downloadPlan);
    if (editableNodeIndexes.length > 0) {
      await openArtifactDownloadSelectionEditor(downloadPlanner);
      hasOpenedVariantSelection = true;
      downloadPlan = downloadPlanner.getPlan();
    }
  }

  let editableNodeIndexes = getEditableArtifactPlanModelNodeIndexes(downloadPlan);
  maybeExitIfNothingToDownload({
    logger,
    request,
    downloadPlan,
    commandTarget,
    loadTarget,
    showSelectHint: editableNodeIndexes.length > 0 && !select,
  });

  if (!yes && !hasOpenedVariantSelection) {
    const downloadConfirmationAction = await askToChooseDownloadAction({
      canSelectVariants: editableNodeIndexes.length > 0,
      downloadAction: downloadPlan.downloadAction,
    });
    if (downloadConfirmationAction === "cancel") {
      process.exit(1);
    }
    if (downloadConfirmationAction === "selectVariants") {
      await openArtifactDownloadSelectionEditor(downloadPlanner);
      downloadPlan = downloadPlanner.getPlan();
      editableNodeIndexes = getEditableArtifactPlanModelNodeIndexes(downloadPlan);
      maybeExitIfNothingToDownload({
        logger,
        request,
        downloadPlan,
        commandTarget,
        loadTarget,
        showSelectHint: false,
      });
    }
  }

  downloadPlan = downloadPlanner.getPlan();
  if (downloadPlan.downloadAction === "none") {
    maybeExitIfNothingToDownload({
      logger,
      request,
      downloadPlan,
      commandTarget,
      loadTarget,
      showSelectHint: false,
    });
  }

  await handleDownloadWithProgressBar(logger, async downloadOpts => {
    return await downloadPlanner.download(downloadOpts);
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

export const get = getCommand;
