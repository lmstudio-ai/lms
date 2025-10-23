import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import {
  doesFileNameIndicateModel,
  makeTitledPrettyError,
  modelExtensions,
  type SimpleLogger,
  text,
} from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import chalk from "chalk";
import { existsSync, statSync } from "fs";
import { access, copyFile, link, mkdir, readFile, rename, symlink } from "fs/promises";
import fuzzy from "fuzzy";
import inquirer, { type PromptModule } from "inquirer";
import inquirerPrompt from "inquirer-autocomplete-prompt";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import { z } from "zod";
import { getCliPref } from "../cliPref.js";
import { defaultModelsFolder } from "../lmstudioPaths.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";

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

/**
 * Validate that a file path exists and is a file (not directory)
 */
function validateFilePath(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new InvalidArgumentError(`File does not exist`);
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new InvalidArgumentError(`Path is not a file`);
  }
}

export const importCmd = addLogLevelOptions(
  new Command()
    .name("import")
    .description("Import a model file into LM Studio")
    .argument("<file-path>", "Path to the model file to import", value => {
      validateFilePath(value);
      return value;
    })
    .option(
      "-y, --yes",
      text`
        Suppress all confirmations and warnings. Will also attempt to automatically resolve the
        user and repository from the file name.
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
    ),
).action(async (path, options) => {
  const logger = createLogger(options);
  const { yes = false, copy, hardLink, symbolicLink, dryRun } = options;
  let { userRepo } = options;
  logger.debug("Importing model file", path);

  if ((copy === true ? 1 : 0) + (hardLink === true ? 1 : 0) + (symbolicLink === true ? 1 : 0) > 1) {
    logger.error(
      makeTitledPrettyError(
        "Invalid Usage",
        "Cannot specify more than one of --copy, --hard-link, or --symbolic-link",
      ),
    );
    process.exit(1);
  }
  const move = copy !== true && hardLink !== true && symbolicLink !== true;
  const pm = inquirer.createPromptModule({
    output: process.stderr,
  });
  await validateModelNameOrWarn(logger, pm, path, yes);
  if (symbolicLink) {
    await maybeWarnAboutWindowsSymlink(logger);
  }
  const modelsFolderPath = await resolveModelsFolderPath(logger);
  if (move) {
    await warnAboutMove(logger, pm, yes, modelsFolderPath);
  }

  if (userRepo === undefined) {
    userRepo = await resolveUserRepo(logger, pm, path, yes);
  }

  const [user, repo] = userRepo;

  const targetPath = join(modelsFolderPath, user, repo, basename(path));

  logger.debug("Target path", targetPath);
  try {
    await access(targetPath);
    logger.error("Target file already exists:", targetPath);
    process.exit(1);
  } catch (error) {
    /* ignore */
  }

  if (dryRun) {
    if (move) {
      logger.info("Would move the file to", targetPath);
    } else if (copy) {
      logger.info("Would copy the file to", targetPath);
    } else if (hardLink) {
      logger.info("Would create a hard link at", targetPath);
    } else if (symbolicLink) {
      logger.info("Would create a symbolic link at", targetPath);
    }
    logger.info(`But not actually doing it because of ${chalk.yellow("--dry-run")}`);
  } else {
    if (move) {
      await importViaMove(logger, path, targetPath);
    } else if (copy) {
      await importViaCopy(logger, path, targetPath);
    } else if (hardLink) {
      await importViaHardLink(logger, path, targetPath);
    } else if (symbolicLink) {
      await importViaSymbolicLink(logger, path, targetPath);
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
async function importViaMove(logger: SimpleLogger, sourcePath: string, targetPath: string) {
  await mkdir(dirname(targetPath), { recursive: true });
  await rename(sourcePath, targetPath);
  logger.info("File moved to", targetPath);
}

/**
 * Import the model file by copying it to the target path.
 *
 * @param logger - The logger to use.
 * @param sourcePath - The source path of the file.
 * @param targetPath - The target path of the file.
 * @returns A promise that resolves when the file is copied.
 */
async function importViaCopy(logger: SimpleLogger, sourcePath: string, targetPath: string) {
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  logger.info("File copied to", targetPath);
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
async function importViaSymbolicLink(logger: SimpleLogger, sourcePath: string, targetPath: string) {
  await mkdir(dirname(targetPath), { recursive: true });
  await symlink(sourcePath, targetPath);
  logger.info("Symbolic link created at", targetPath);
}

/**
 * Validate the model file name and warn the user if it does not look like a model file.
 *
 * @param logger - The logger to use.
 * @param pm - The prompt module to use.
 * @param path - The path of the file.
 * @param yes - Whether to suppress warnings.
 * @returns A promise that resolves when the user confirms to continue.
 */
async function validateModelNameOrWarn(
  logger: SimpleLogger,
  pm: PromptModule,
  path: string,
  yes: boolean,
) {
  if (!doesFileNameIndicateModel(path)) {
    if (yes) {
      logger.warn("The file name does not look like a model file. This may not work.");
      logger.warn(`Model files usually have extensions: ${modelExtensions.join(", ")}`);
    } else {
      process.stderr.write(text`
        ${"\n"}${chalk.yellow.underline(" File does not look like a model file ")}

        This file does not look like a model file:

            ${chalk.gray(path)}

        Model files usually have extension: ${modelExtensions.join(", ")}${"\n\n"}
      `);
      const { cont } = await pm([
        {
          type: "confirm",
          name: "cont",
          message: chalk.green("Do you wish to continue? (Not recommended)"),
          default: false,
        },
      ]);
      // cont is any as returned from 3p module
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (!cont) {
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
async function maybeWarnAboutWindowsSymlink(logger: SimpleLogger) {
  if (process.platform === "win32") {
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
  const appDataFolderPath = getUserAppDataPath();
  logger.debug("AppData folder path", appDataFolderPath);
  const settingsJsonFilePath = join(appDataFolderPath, "LM Studio", "settings.json");
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
 * @param pm - The prompt module to use.
 * @param yes - Whether to suppress warnings.
 * @param modelsFolderPath - The path to the models folder.
 */
async function warnAboutMove(
  logger: SimpleLogger,
  pm: PromptModule,
  yes: boolean,
  modelsFolderPath: string,
) {
  const cliPref = await getCliPref(logger);
  if (cliPref.get().importWillMoveWarned === true) {
    return;
  }
  if (yes) {
    logger.warn("Warning about move suppressed by the --yes flag.");
    return;
  }
  logger.debug("Asking user to confirm moving the file");
  process.stderr.write(text`
    ${"\n"}${chalk.green.underline(" Importing model file into LM Studio ")}

    By default, ${chalk.yellow("lms import")} will ${chalk.cyan("move")} the file to LM
    Studio's models folder:

        ${chalk.gray(modelsFolderPath)}

    If you want to ${chalk.cyan("copy")} the file instead, use the ${chalk.yellow("--copy")}
    flag.

    If you want to create a ${chalk.cyan("symbolic link")} instead, use the
    ${chalk.yellow("--symbolic-link")} flag.

    If you want to create a ${chalk.cyan("hard link")} instead, use the
    ${chalk.yellow("--hard-link")} flag.

    This message will only show up once. You can always look up the usage via the
    ${chalk.yellow("--help")} flag.${"\n\n"}
  `);
  const { cont } = await pm([
    {
      type: "confirm",
      name: "cont",
      message: chalk.green("Do you wish to continue?"),
      default: true,
    },
  ]);
  // cont is any as returned from 3p module
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!cont) {
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
 * Resolve the user and repository of the model file.
 *
 * @param logger - The logger to use.
 * @param pm - The prompt module to use.
 * @param path - The path of the file.
 * @param yes - Whether to suppress warnings.
 */
async function resolveUserRepo(
  logger: SimpleLogger,
  pm: PromptModule,
  path: string,
  yes: boolean,
): Promise<[string, string]> {
  const fileName = basename(path);
  if (yes) {
    logger.info("Attempting to find the model on Hugging Face...");
    const candidates = await findCandidateHuggingFaceUserRepos(logger, fileName);
    if (candidates.length > 0) {
      return candidates[0];
    }
    logger.info("Cannot find the model on Hugging Face, use default naming...");

    // Use user name as user
    // Use file name without extension as repo
    return [getDefaultUserName(), autoNameRepo(fileName)];
  }
  const resolutionMethod: ResolutionMethod = (
    await pm({
      type: "list",
      name: "value",
      message: chalk.green("Choose categorization option"),
      choices: [
        {
          name: text`
            Auto search Hugging Face
            ${chalk.gray("(Recommended for models downloaded from Hugging Face)")}
          `,
          value: "huggingFace",
        },
        {
          name: text`
            Interactive import
            ${chalk.gray("(Recommended for custom models)")}
          `,
          value: "custom",
        },
        {
          name: text`
            Don't categorize
            ${chalk.gray("(will put the model under imported-models/uncategorized)")}
          `,
          value: "uncategorized",
        },
      ],
    })
  ).value;
  if (resolutionMethod === "custom") {
    return await resolveByAskUserRepo(logger, pm, path);
  } else if (resolutionMethod === "huggingFace") {
    return await resolveByHuggingFaceInteractive(logger, pm, fileName);
  } else {
    return ["imported-models", "uncategorized"];
  }
}

/**
 * Resolve the user and repository of the model file by asking the user.
 *
 * @param logger - The logger to use.
 * @param pm - The prompt module to use.
 * @param path - The path of the file.
 */
async function resolveByAskUserRepo(
  logger: SimpleLogger,
  pm: PromptModule,
  path: string,
): Promise<[string, string]> {
  const { user, repo } = await pm([
    {
      type: "input",
      name: "user",
      message: chalk.green("Who is the creator of the model?"),
      default: getDefaultUserName(),
      validate: input => isValidFolderName("User", input),
    },
    {
      type: "input",
      name: "repo",
      message: chalk.green("What is the model name?"),
      default: autoNameRepo(basename(path)),
      validate: input => isValidFolderName("Repository", input),
    },
  ]);

  logger.debug("User and repo answered", user, repo);

  return [user, repo];
}

/**
 * Resolve the user and repository of the model file by searching Hugging Face.
 *
 * @param logger - The logger to use.
 * @param pm - The prompt module to use.
 * @param fileName - The file name.
 */
async function resolveByHuggingFaceInteractive(
  logger: SimpleLogger,
  pm: PromptModule,
  fileName: string,
): Promise<[string, string]> {
  logger.info("Searching for the model on Hugging Face using the file name...");
  const candidates = (await findCandidateHuggingFaceUserRepos(logger, fileName)).slice(0, 25);
  if (candidates.length === 0) {
    logger.warnText`
      Cannot find the model on Hugging Face, you need to manually specify the user/repo.
    `;
    return await resolveByAskUserRepo(logger, pm, fileName);
  }
  const candidatesJoined = candidates.map(([user, repo]) => `${user}/${repo}`);
  logger.info("Found the following repositories on Hugging Face containing this file:");
  pm.registerPrompt("autocomplete", inquirerPrompt);
  const { selected } = await pm({
    type: "autocomplete",
    name: "selected",
    message: chalk.green("Please select the correct one") + chalk.gray(" |"),
    loop: false,
    pageSize: terminalSize().rows - 3,
    emptyText: "No model matched the filter",
    source: async (_: any, input: string) => {
      const options = fuzzy.filter(
        input === undefined || input === null ? "" : input,
        candidatesJoined,
        {
          pre: "\x1b[91m",
          post: "\x1b[39m",
        },
      );
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
  } as any);
  if (selected === null) {
    logger.info("Please specify the user and repository manually.");
    return await resolveByAskUserRepo(logger, pm, fileName);
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
 * @param fileName - The file name.
 * @returns A promise that resolves with the candidate user and repository names.
 */
async function findCandidateHuggingFaceUserRepos(logger: SimpleLogger, fileName: string) {
  const fullSearchTerm = await cleanFileName(fileName);
  const breakingPoints = await findFileNameBreakPoints(fullSearchTerm);
  breakingPoints.push(fullSearchTerm.length);

  const candidates: Array<[string, string]> = [];

  for (let i = breakingPoints.length - 1; i >= 0; i--) {
    const term = fullSearchTerm.substring(0, breakingPoints[i]);
    const repos = await queryHuggingFace(logger, term);
    for (const repo of repos) {
      if (
        repo.siblings.some(sibling => sibling.rfilename.toLowerCase() === fileName.toLowerCase())
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
