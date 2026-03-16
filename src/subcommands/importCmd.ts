import { Command, InvalidArgumentError, type OptionValues } from "@commander-js/extra-typings";
import { confirm, input as promptInput, search, select } from "@inquirer/prompts";
import {
  doesFileNameIndicateModel,
  makeTitledPrettyError,
  modelExtensions,
  type SimpleLogger,
  text,
} from "@lmstudio/lms-common";
import { findLMStudioHome } from "@lmstudio/lms-common-server";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import chalk from "chalk";
import { existsSync, realpathSync, statSync } from "fs";
import { access, copyFile, cp, link, mkdir, readFile, rename, symlink } from "fs/promises";
import fuzzy from "fuzzy";
import { homedir } from "os";
import { basename, dirname, join, resolve as resolvePath } from "path";
import { z } from "zod";
import { getCliPref } from "../cliPref.js";
import { defaultModelsFolder } from "../lmstudioPaths.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { runPromptWithExitHandling } from "../prompt.js";
import { fuzzyHighlightOptions, searchTheme } from "../inquirerTheme.js";

/**
 * Parse user/repo string into tuple
 */
function parseUserRepo(value: string): [string, string] {
  const parts = value.split("/");
  if (parts.length !== 2) {
    throw new InvalidArgumentError("Must be user and repo separated by a slash.");
  }
  return parts as [string, string];
}

const mlxMarkerFileName = "model.safetensors";

/**
 * Validate that a path exists and is a model file or an MLX model folder.
 */
function validateImportPath(importPath: string): void {
  if (!existsSync(importPath)) {
    throw new InvalidArgumentError(`File or folder does not exist`);
  }

  const stats = statSync(importPath);
  if (stats.isFile()) {
    return;
  }

  if (stats.isDirectory()) {
    const markerPath = join(importPath, mlxMarkerFileName);
    if (!existsSync(markerPath)) {
      throw new InvalidArgumentError(
        `Folder does not look like an MLX model (missing ${mlxMarkerFileName})`,
      );
    }
    const markerStats = statSync(markerPath);
    if (!markerStats.isFile()) {
      throw new InvalidArgumentError(
        `Folder does not look like an MLX model (missing ${mlxMarkerFileName})`,
      );
    }
    return;
  }

  throw new InvalidArgumentError(`Path must be a file or folder`);
}

type ImportCommandOptions = OptionValues &
  LogLevelArgs & {
    yes?: boolean;
    userRepo?: [string, string];
    copy?: boolean;
    hardLink?: boolean;
    symbolicLink?: boolean;
    dryRun?: boolean;
  };

const missingFilePathHelpMessage = text`
  Provide the path to the model file or folder you downloaded (e.g. .gguf or MLX).

  Examples:

      ${chalk.yellow("lms import ~/Downloads/mistral-7b-instruct.Q4_K_M.gguf")}
      ${chalk.yellow("lms import ~/Downloads/Qwen3-VL-4B-Instruct-MLX-4bit")}
`;

const importCommand = new Command<[], ImportCommandOptions>()
  .name("import")
  .description("Import a model file or folder into LM Studio")
  .argument("<file-path>", "Path to the model file or folder to import", value => {
    validateImportPath(value);
    return value;
  })
  .option(
    "-y, --yes",
    text`
      Automatically approve all prompts. Will also attempt to automatically resolve the
      user and repository from the file or folder name.
    `,
  )
  .option(
    "--user-repo <user/repo>",
    text`
      Manually provide the user and repository in the format "user/repo". Specifying this will
      skip prompts about how to categorize the model file.
    `,
    parseUserRepo,
  )
  .option(
    "-c, --copy",
    text`
      Copy the file instead of moving it. This is useful when you want to keep the original file
      in place.
    `,
  )
  .option(
    "-L, --hard-link",
    text`
      Create a hard link instead of moving or copying the file. This is useful when you want to
      keep the original file in place.
    `,
  )
  .option(
    "-l, --symbolic-link",
    text`
      Create a symbolic link instead of moving or copying the file. This is useful when you want
      to keep the original file in place.
    `,
  )
  .option(
    "--dry-run",
    text`
      Do not actually perform the import, just show what would be done.
    `,
  );

importCommand.configureOutput({
  outputError: (str, write) => {
    if (str.startsWith("error: missing required argument 'file-path'")) {
      write(
        `${str.trimEnd()}\n\n${missingFilePathHelpMessage}\n\n${chalk.blue(
          "Run 'lms import -h' for more info.",
        )}\n\n`,
      );
    } else {
      write(str);
    }
  },
});

addLogLevelOptions(importCommand);

importCommand.action(async (path, options: ImportCommandOptions) => {
  const logger = createLogger(options);
  const {
    yes = false,
    copy: copyOption,
    hardLink: hardLinkOption,
    symbolicLink: symbolicLinkOption,
    dryRun: dryRunOption,
  } = options;
  let { userRepo } = options;
  logger.debug("Importing model path", path);

  const sourceStats = statSync(path);
  const isDirectory = sourceStats.isDirectory();
  const isMlxModelDir = isDirectory && doesDirectoryContainMlxMarker(path);
  if (isDirectory && !isMlxModelDir) {
    logger.error(
      makeTitledPrettyError(
        "Invalid Usage",
        `Folder does not look like an MLX model (missing ${mlxMarkerFileName})`,
      ),
    );
    process.exit(1);
  }

  const isCopy = copyOption === true;
  const isHardLink = hardLinkOption === true;
  const isSymbolicLink = symbolicLinkOption === true;
  const isDryRun = dryRunOption === true;

  if ((isCopy ? 1 : 0) + (isHardLink ? 1 : 0) + (isSymbolicLink ? 1 : 0) > 1) {
    logger.error(
      makeTitledPrettyError(
        "Invalid Usage",
        "Cannot specify more than one of --copy, --hard-link, or --symbolic-link",
      ),
    );
    process.exit(1);
  }
  const move = isCopy !== true && isHardLink !== true && isSymbolicLink !== true;
  if (isHardLink && isDirectory) {
    logger.error(
      makeTitledPrettyError(
        "Invalid Usage",
        "Cannot create a hard link for a folder. Use --symbolic-link or --copy instead.",
      ),
    );
    process.exit(1);
  }

  await validateModelPathOrWarn(logger, path, yes, isMlxModelDir);
  if (isSymbolicLink === true) {
    await maybeWarnAboutWindowsSymlink(logger, isDirectory);
  }
  const modelsFolderPath = await resolveModelsFolderPath(logger);
  if (move) {
    await warnAboutMove(logger, yes, modelsFolderPath, isDirectory);
  }

  if (userRepo === undefined) {
    userRepo = await resolveUserRepo(logger, path, yes, isMlxModelDir);
  }

  const [user, repo] = userRepo;

  const baseTargetPath = join(modelsFolderPath, user, repo);
  const targetPath = isMlxModelDir ? baseTargetPath : join(baseTargetPath, basename(path));

  logger.debug("Target path", targetPath);
  try {
    await access(targetPath);
    logger.error("Target file already exists:", targetPath);
    process.exit(1);
  } catch (error) {
    /* ignore */
  }

  if (isDryRun === true) {
    if (move) {
      logger.info("Would move to", targetPath);
    } else if (isCopy === true) {
      logger.info("Would copy to", targetPath);
    } else if (isHardLink === true) {
      logger.info("Would create a hard link at", targetPath);
    } else if (isSymbolicLink === true) {
      logger.info("Would create a symbolic link at", targetPath);
    }
    logger.info(`But not actually doing it because of ${chalk.yellow("--dry-run")}`);
  } else {
    if (move) {
      await importViaMove(logger, path, targetPath, isDirectory);
    } else if (isCopy === true) {
      await importViaCopy(logger, path, targetPath, isDirectory);
    } else if (isHardLink === true) {
      await importViaHardLink(logger, path, targetPath);
    } else if (isSymbolicLink === true) {
      await importViaSymbolicLink(logger, path, targetPath, isDirectory);
    }
  }
});

/**
 * Import the model file by moving it to the target path.
 *
 * @param logger - The logger to use.
 * @param sourcePath - The source path of the file.
 * @param targetPath - The target path of the file.
 * @returns A promise that resolves when the file is moved.
 */
async function importViaMove(
  logger: SimpleLogger,
  sourcePath: string,
  targetPath: string,
  isDirectory: boolean,
) {
  await mkdir(dirname(targetPath), { recursive: true });
  await rename(sourcePath, targetPath);
  logger.info(isDirectory ? "Folder moved to" : "File moved to", targetPath);
}

/**
 * Import the model file by copying it to the target path.
 *
 * @param logger - The logger to use.
 * @param sourcePath - The source path of the file.
 * @param targetPath - The target path of the file.
 * @returns A promise that resolves when the file is copied.
 */
async function importViaCopy(
  logger: SimpleLogger,
  sourcePath: string,
  targetPath: string,
  isDirectory: boolean,
) {
  await mkdir(dirname(targetPath), { recursive: true });
  if (isDirectory) {
    await cp(sourcePath, targetPath, { recursive: true });
    logger.info("Folder copied to", targetPath);
  } else {
    await copyFile(sourcePath, targetPath);
    logger.info("File copied to", targetPath);
  }
}

/**
 * Import the model file by creating a hard link to the target path.
 *
 * @param logger - The logger to use.
 * @param sourcePath - The source path of the file.
 * @param targetPath - The target path of the file.
 * @returns A promise that resolves when the hard link is created.
 */
async function importViaHardLink(logger: SimpleLogger, sourcePath: string, targetPath: string) {
  await mkdir(dirname(targetPath), { recursive: true });
  await link(sourcePath, targetPath);
  logger.info("Hard link created at", targetPath);
}

/**
 * Import the model file by creating a symbolic link to the target path.
 *
 * @param logger - The logger to use.
 * @param sourcePath - The source path of the file.
 * @param targetPath - The target path of the file.
 * @returns A promise that resolves when the symbolic link is created.
 */
async function importViaSymbolicLink(
  logger: SimpleLogger,
  sourcePath: string,
  targetPath: string,
  isDirectory: boolean,
) {
  await mkdir(dirname(targetPath), { recursive: true });
  const linkSourcePath = resolveSymlinkTargetPath(sourcePath);
  const resolvedTargetPath = resolvePath(targetPath);
  const realSourcePath = resolvePathForSelfLinkCheck(linkSourcePath);
  if (realSourcePath === resolvedTargetPath) {
    logger.error(
      makeTitledPrettyError(
        "Invalid Usage",
        "Cannot create a symbolic link to the same path. The model is already in the target location.",
      ),
    );
    process.exit(1);
  }
  if (isDirectory && process.platform === "win32") {
    await symlink(linkSourcePath, targetPath, "junction");
  } else if (isDirectory) {
    await symlink(linkSourcePath, targetPath, "dir");
  } else {
    await symlink(linkSourcePath, targetPath, "file");
  }
  logger.info("Symbolic link created at", targetPath);
}

/**
 * Validate the model file name and warn the user if it does not look like a model file.
 *
 * @param logger - The logger to use.
 * @param path - The path of the file.
 * @param yes - Whether to suppress warnings.
 * @returns A promise that resolves when the user confirms to continue.
 */
async function validateModelPathOrWarn(
  logger: SimpleLogger,
  path: string,
  yes: boolean,
  isMlxModelDir: boolean,
) {
  if (isMlxModelDir) {
    return;
  }
  if (!doesFileNameIndicateModel(path)) {
    if (yes) {
      logger.warn("The file name does not look like a model file. This may not work.");
      logger.warn(`Model files usually have extensions: ${modelExtensions.join(", ")}`);
    } else {
      process.stderr.write(text`
        ${"\n"}${chalk.yellow.underline(" File does not look like a model file ")}

        This file does not look like a model file:

            ${chalk.dim(path)}

        Model files usually have extension: ${modelExtensions.join(", ")}${"\n\n"}
      `);
      const shouldContinue = await runPromptWithExitHandling(() =>
        confirm(
          {
            message: chalk.green("Do you wish to continue? (Not recommended)"),
            default: false,
          },
          { output: process.stderr },
        ),
      );
      if (shouldContinue !== true) {
        process.exit(1);
      }
    }
  }
}

/**
 * Warn the user about the potential failure of creating symbolic links on Windows.
 *
 * @param logger - The logger to use.
 */
async function maybeWarnAboutWindowsSymlink(logger: SimpleLogger, isDirectory: boolean) {
  if (process.platform === "win32" && !isDirectory) {
    logger.warnText`
      Due to Windows usually require administrator privileges to create symbolic links, this
      operation may fail.
    `;
    logger.warn("You can try creating hard links instead. (Use the --hard-link flag)");
  }
}

/**
 * Get the path to the user's application data folder.
 *
 * @returns The path to the user's application data folder.
 */
function getUserAppDataPath() {
  switch (process.platform) {
    case "win32":
      return process.env.APPDATA === undefined || process.env.APPDATA === ""
        ? join(homedir(), "AppData", "Roaming")
        : process.env.APPDATA;
    case "darwin":
      return join(homedir(), "Library", "Application Support");
    case "linux":
      return process.env.XDG_CONFIG_HOME === undefined || process.env.XDG_CONFIG_HOME === ""
        ? join(homedir(), ".config")
        : process.env.XDG_CONFIG_HOME;
    default:
      throw new Error("Unsupported platform");
  }
}

/**
 * Locate the settings.json file of LM Studio.
 *
 * @param logger - The logger to use.
 * @returns A promise that resolves with the path to the settings.json file, or null if it does not
 * exist.
 */
async function locateSettingsJson(logger: SimpleLogger) {
  logger.debug("Locating settings.json");
  const lmstudioHome = findLMStudioHome();
  const settingsJsonFilePath = join(lmstudioHome, "settings.json");
  logger.debug("Settings.json file path", settingsJsonFilePath);
  try {
    await access(settingsJsonFilePath);
    return settingsJsonFilePath;
  } catch (error) {
    logger.debug("settings.json does not exist", error);
    return null;
  }
}

/**
 * Resolve the path to the models folder. If the settings.json file exists, use the downloadsFolder
 * field.
 *
 * @param logger - The logger to use.
 * @returns A promise that resolves with the path to the models folder.
 */
async function resolveModelsFolderPath(logger: SimpleLogger) {
  const settingsJsonPath = await locateSettingsJson(logger);
  let modelsFolderPath = defaultModelsFolder;
  if (settingsJsonPath === null) {
    logger.warn(
      "Could not locate LM Studio configuration file, using default path:",
      modelsFolderPath,
    );
  } else {
    try {
      const content = await readFile(settingsJsonPath, "utf8");
      const settings = JSON.parse(content);
      modelsFolderPath = settings.downloadsFolder;
      if (typeof modelsFolderPath !== "string") {
        throw new Error("downloadsFolder is not a string");
      }
    } catch (error) {
      logger.warn(
        "Could not parse LM Studio configuration file, using default path:",
        modelsFolderPath,
      );
      logger.debug(error);
    }
  }
  await mkdir(modelsFolderPath, { recursive: true });
  return modelsFolderPath;
}

/**
 * Warn the user about moving the file to the models folder if they have not been warned before.
 *
 * @param logger - The logger to use.
 * @param yes - Whether to suppress warnings.
 * @param modelsFolderPath - The path to the models folder.
 */
async function warnAboutMove(
  logger: SimpleLogger,
  yes: boolean,
  modelsFolderPath: string,
  isDirectory: boolean,
) {
  const cliPref = await getCliPref(logger);
  if (cliPref.get().importWillMoveWarned === true) {
    return;
  }
  if (yes) {
    logger.warn("Warning about move suppressed by the --yes flag.");
  }
  logger.debug("Asking user to confirm moving the file");
  const hardLinkLine = isDirectory
    ? ""
    : text`

        If you want to create a ${chalk.cyan("hard link")} instead, use the
        ${chalk.yellow("--hard-link")} flag.
      `;
  process.stderr.write(text`
    ${"\n"}${chalk.green.underline(" Importing model into LM Studio ")}

    By default, ${chalk.yellow("lms import")} will ${chalk.cyan("move")} the model to LM
    Studio's models folder:

        ${chalk.dim(modelsFolderPath)}

    If you want to ${chalk.cyan("copy")} the model instead, use the ${chalk.yellow("--copy")}
    flag.

    If you want to create a ${chalk.cyan("symbolic link")} instead, use the
    ${chalk.yellow("--symbolic-link")} flag.${hardLinkLine}

    This message will only show up once. You can always look up the usage via the
    ${chalk.yellow("--help")} flag.${"\n\n"}
  `);
  const shouldContinue = await runPromptWithExitHandling(() =>
    confirm(
      {
        message: chalk.green("Do you wish to continue?"),
        default: true,
      },
      { output: process.stderr },
    ),
  );
  if (shouldContinue !== true) {
    process.exit(1);
  }
  if (!yes) {
    cliPref.setWithProducer(draft => {
      draft.importWillMoveWarned = true;
    });
  }
}

/**
 * Automatically name the repository based on the file name.
 *
 * @param fileName - The file name.
 * @returns The repository name.
 */
function autoNameRepo(fileName: string) {
  return fileName.replace(/(?:\.Q[^.]{1,5})?\.[^.]+$/, "");
}

/**
 * Get the default user name by checking the USER and USERNAME environment variables.
 *
 * @returns The default user name.
 */
function getDefaultUserName() {
  return process.env.USER ?? process.env.USERNAME ?? "unknown";
}

/**
 * Validate a folder name.
 *
 * @param fieldName - The name of the field.
 * @param value - The value to validate.
 * @returns `true` if the value is valid, or an error message if it is not.
 */
function isValidFolderName(fieldName: string, value: string): true | string {
  if (value === "") {
    return `${fieldName} cannot be empty`;
  }
  if (value.length > 100) {
    return `${fieldName} is too long`;
  }
  if (value.startsWith(".") || value.endsWith(".")) {
    return `${fieldName} cannot start or end with "."`;
  }
  if (value.trim() !== value) {
    return `${fieldName} cannot have leading or trailing spaces`;
  }
  if (/[/<>:"\\|?*]/.test(value)) {
    return `${fieldName} cannot contain special characters`;
  }
  return true;
}

type ResolutionMethod = "custom" | "huggingFace" | "uncategorized";

/**
 * Resolve the user and repository of the model file or folder.
 *
 * @param logger - The logger to use.
 * @param path - The path of the file.
 * @param yes - Whether to suppress warnings.
 */
async function resolveUserRepo(
  logger: SimpleLogger,
  path: string,
  yes: boolean,
  isMlxModelDir: boolean,
): Promise<[string, string]> {
  const fileName = basename(path);
  const defaultRepoName = isMlxModelDir ? fileName : autoNameRepo(fileName);
  const searchName = fileName;
  const requiredFilename = isMlxModelDir ? mlxMarkerFileName : fileName;
  if (yes) {
    logger.info("Attempting to find the model on Hugging Face...");
    const candidates = await findCandidateHuggingFaceUserRepos(
      logger,
      searchName,
      requiredFilename,
    );
    if (candidates.length > 0) {
      return candidates[0];
    }
    logger.info("Cannot find the model on Hugging Face, use default naming...");

    // Use user name as user
    // Use file name without extension as repo
    return [getDefaultUserName(), defaultRepoName];
  }
  const resolutionMethod: ResolutionMethod = await runPromptWithExitHandling(() =>
    select<ResolutionMethod>(
      {
        message: chalk.green("Choose categorization option"),
        choices: [
          {
            name: text`
              Auto search Hugging Face
              ${chalk.dim("(Recommended for models downloaded from Hugging Face)")}
            `,
            value: "huggingFace",
          },
          {
            name: text`
              Interactive import
              ${chalk.dim("(Recommended for custom models)")}
            `,
            value: "custom",
          },
          {
            name: text`
              Don't categorize
              ${chalk.dim(`(will put the model under imported-models/${defaultRepoName})`)}
            `,
            value: "uncategorized",
          },
        ],
      },
      { output: process.stderr },
    ),
  );
  if (resolutionMethod === "custom") {
    return await resolveByAskUserRepo(logger, defaultRepoName);
  } else if (resolutionMethod === "huggingFace") {
    return await resolveByHuggingFaceInteractive(
      logger,
      searchName,
      requiredFilename,
      defaultRepoName,
    );
  } else {
    return ["imported-models", defaultRepoName];
  }
}

/**
 * Resolve the user and repository of the model file by asking the user.
 *
 * @param logger - The logger to use.
 * @param path - The path of the file.
 */
async function resolveByAskUserRepo(
  logger: SimpleLogger,
  defaultRepoName: string,
): Promise<[string, string]> {
  const user = await runPromptWithExitHandling(() =>
    promptInput(
      {
        message: chalk.green("Who is the creator of the model?"),
        default: getDefaultUserName(),
        validate: (inputValue: string) => isValidFolderName("User", inputValue),
      },
      { output: process.stderr },
    ),
  );
  const repo = await runPromptWithExitHandling(() =>
    promptInput(
      {
        message: chalk.green("What is the model name?"),
        default: defaultRepoName,
        validate: (inputValue: string) => isValidFolderName("Repository", inputValue),
      },
      { output: process.stderr },
    ),
  );

  logger.debug("User and repo answered", user, repo);

  return [user, repo];
}

/**
 * Resolve the user and repository of the model by searching Hugging Face.
 *
 * @param logger - The logger to use.
 * @param searchName - The file or folder name to search with.
 * @param requiredFilename - The required file name that must exist in the repo.
 * @param defaultRepoName - The default repo name to use when falling back.
 */
async function resolveByHuggingFaceInteractive(
  logger: SimpleLogger,
  searchName: string,
  requiredFilename: string,
  defaultRepoName: string,
): Promise<[string, string]> {
  logger.info("Searching for the model on Hugging Face using the model name...");
  const candidates = (
    await findCandidateHuggingFaceUserRepos(logger, searchName, requiredFilename)
  ).slice(0, 25);
  if (candidates.length === 0) {
    logger.warnText`
      Cannot find the model on Hugging Face, you need to manually specify the user/repo.
    `;
    return await resolveByAskUserRepo(logger, defaultRepoName);
  }
  const candidatesJoined = candidates.map(([user, repo]) => `${user}/${repo}`);
  logger.info(
    "Found the following repositories on Hugging Face containing the file:",
    requiredFilename,
  );
  const pageSize = terminalSize().rows - 3;
  const selected = await runPromptWithExitHandling(() =>
    search<[string, string] | null>(
      {
        message: chalk.green("Please select the correct one") + chalk.dim(" |"),
        pageSize,
        theme: searchTheme,
        source: async (inputValue: string | undefined, { signal }: { signal: AbortSignal }) => {
          void signal;
          const options = fuzzy.filter(inputValue ?? "", candidatesJoined, fuzzyHighlightOptions);
          return [
            ...options.map(option => {
              return {
                value: candidates[option.index],
                short: option.original,
                name: option.string,
              };
            }),
            { value: null, short: "None of the above", name: "None of the above" },
          ];
        },
      },
      { output: process.stderr },
    ),
  );
  if (selected === null) {
    logger.info("Please specify the user and repository manually.");
    return await resolveByAskUserRepo(logger, defaultRepoName);
  } else {
    return selected;
  }
}

const breakingPointChars = ["-", "."];

/**
 * Find the breaking points in a file name. This for determining the search term for Hugging Face.
 *
 * @param fileName - The file name.
 * @returns The breaking points in the file name.
 */
async function findFileNameBreakPoints(fileName: string) {
  const breakingPoints: Array<number> = [];
  let index = 0;
  let isCurrentlyInBreakingPoint = false;
  for (const char of fileName) {
    if (breakingPointChars.includes(char)) {
      if (!isCurrentlyInBreakingPoint) {
        breakingPoints.push(index);
        isCurrentlyInBreakingPoint = true;
      }
    } else {
      isCurrentlyInBreakingPoint = false;
    }
    index++;
  }
  return breakingPoints;
}

async function cleanFileName(fileName: string) {
  return fileName.replace(/-I?Q\d[_0-9A-Za-z]{0,6}/, "");
}

function doesDirectoryContainMlxMarker(path: string): boolean {
  const markerPath = join(path, mlxMarkerFileName);
  if (!existsSync(markerPath)) {
    return false;
  }
  try {
    const stats = statSync(markerPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function resolveSymlinkTargetPath(sourcePath: string): string {
  const resolvedPath = resolvePath(sourcePath);
  return resolvedPath;
}

function resolvePathForSelfLinkCheck(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const searchResultSchema = z.array(
  z.object({
    id: z.string(),
    siblings: z.array(
      z.object({
        rfilename: z.string(),
      }),
    ),
  }),
);

/**
 * Query Hugging Face for a term.
 *
 * @param logger - The logger to use.
 * @param term - The term to search for.
 * @returns A promise that resolves with the search results.
 */
async function queryHuggingFace(logger: SimpleLogger, term: string) {
  logger.debug("Querying Hugging Face for", term);
  const json = await fetch(
    `https://huggingface.co/api/models?search=${encodeURIComponent(term)}&full=true&sort=likes`,
  ).then(response => response.json());
  const result = searchResultSchema.safeParse(json);
  if (!result.success) {
    logger.warn("Failed to parse Hugging Face search result");
    logger.debug(result.error);
    return [];
  } else {
    logger.debug(`Found ${result.data.length} results`);
    return result.data;
  }
}

const userScores = new Map([
  ["lmstudio-community", 3],
  ["bartowski", 2],
  ["TheBloke", 1],
]);

/**
 * Find candidate user and repository names on Hugging Face.
 *
 * @param logger - The logger to use.
 * @param searchName - The file or folder name to search with.
 * @param requiredFilename - The required file name that must exist in the repo.
 * @returns A promise that resolves with the candidate user and repository names.
 */
async function findCandidateHuggingFaceUserRepos(
  logger: SimpleLogger,
  searchName: string,
  requiredFilename: string,
) {
  const fullSearchTerm = await cleanFileName(searchName);
  const breakingPoints = await findFileNameBreakPoints(fullSearchTerm);
  breakingPoints.push(fullSearchTerm.length);

  const candidates: Array<[string, string]> = [];

  for (let i = breakingPoints.length - 1; i >= 0; i--) {
    const term = fullSearchTerm.substring(0, breakingPoints[i]);
    const repos = await queryHuggingFace(logger, term);
    for (const repo of repos) {
      if (
        repo.siblings.some(
          sibling => sibling.rfilename.toLowerCase() === requiredFilename.toLowerCase(),
        )
      ) {
        const split = repo.id.split("/");
        if (split.length === 2) {
          candidates.push(split as [string, string]);
        }
      }
    }
    if (candidates.length > 0) {
      break;
    }
  }

  candidates.sort((a, b) => {
    const aScore = userScores.get(a[0]) ?? 0;
    const bScore = userScores.get(b[0]) ?? 0;
    return bScore - aScore;
  });

  logger.debug("Candidates found", candidates);
  return candidates;
}

export const importCmd = importCommand;
