import { Command } from "@commander-js/extra-typings";
import { input as promptInput, search } from "@inquirer/prompts";
import { filteredArray, text, type SimpleLogger } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import chalk from "chalk";
import { exec, spawn } from "child_process";
import fg from "fast-glob";
import { existsSync } from "fs";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "fs/promises";
import fuzzy from "fuzzy";
import { tmpdir } from "os";
import { join } from "path";
import util from "util";
import { z } from "zod";
import { addLogLevelOptions, createLogger } from "../logLevel.js";
import { ProgressBar } from "../ProgressBar.js";
import { runPromptWithExitHandling } from "../prompt.js";
import { ANSI_CYAN, ANSI_RESET_COLOR, fuzzyHighlightOptions, searchTheme } from "../inquirerTheme.js";

const execAsync = util.promisify(exec);
const illegalPathChars = ["/", "\\", ":", "*", "?", '"', "<", ">", "|"];
const illegalPaths = [".", ".."];

async function checkIfCommandExists(logger: SimpleLogger, command: string) {
  logger.debug(`Checking if ${command} exists...`);
  try {
    const { stdout } = await execAsync(`${command} --version`);
    logger.debug(`Found ${command}: ${stdout.trim()}`);
    return true;
  } catch (error) {
    logger.debug(`Failed to run ${command} --version`, error);
    return false;
  }
}

const scaffoldSchema = z.object({
  scaffoldVersion: z.literal(1),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  args: z.array(
    z.object({
      name: z.string(),
      replaceFrom: z.array(z.string()).optional(),
      default: z.string(),
      isProjectName: z.boolean().optional(),
    }),
  ),
  renames: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  motd: z.array(
    z.object({
      text: z.string(),
      type: z.enum(["regular", "title", "command", "hint"]),
    }),
  ),
});
type Scaffold = z.infer<typeof scaffoldSchema>;

const scaffoldBasicsListSchema = z.object({
  scaffoldVersion: z.number(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
});
type ScaffoldBasicsList = z.infer<typeof scaffoldBasicsListSchema>;

async function getScaffolds(_logger: SimpleLogger) {
  const url = "https://scaffolds-manifest.lmstudio.ai";
  const response = await fetch(url);
  const json = await response.json();
  if (!Array.isArray(json)) {
    throw new Error("Invalid response from the server.");
  }

  return json as Array<unknown>;
}

const createCommand = new Command()
  .name("create")
  .description("Create a new project with scaffolding")
  .argument("[scaffold]", "The scaffold to use");

addLogLevelOptions(createCommand);

createCommand.action(async (scaffoldName, options) => {
  const logger = createLogger(options);
  let allScaffolds: Array<unknown>;
  logger.info("Fetching scaffolds list...");
  try {
    allScaffolds = await getScaffolds(logger);
  } catch (error) {
    logger.error("Failed to fetch scaffolds", error);
    return;
  }
  logger.debug(`Found ${allScaffolds.length} scaffolds`);
  const scaffoldBasicsList = filteredArray(scaffoldBasicsListSchema).parse(allScaffolds);
  if (scaffoldBasicsList.length !== allScaffolds.length) {
    logger.warn(
      "Cannot parse some of the scaffolds. This is likely due to outdated LM Studio Version.",
    );
    logger.warn("Please update LM Studio from https://lmstudio.ai");
  }

  console.info(
    text`
        ${chalk.green.underline(" Welcome to LM Studio Interactive Project Creator ")}

       Select a scaffold to use from the list below.
      `,
  );

  // Try exact match first.
  let selectedIndex = scaffoldBasicsList.findIndex(({ name }) => name === scaffoldName);

  const searchKeys = scaffoldBasicsList.map(({ name, displayName }) => {
    return `${displayName} (${name})`;
  });
  if (selectedIndex === -1) {
    if (scaffoldName === undefined) {
      selectedIndex = await selectScaffold(scaffoldBasicsList, searchKeys, "", 7);
    } else {
      selectedIndex = await selectScaffold(scaffoldBasicsList, searchKeys, scaffoldName, 7);
    }
  }

  const scaffold = scaffoldSchema.safeParse(
    (allScaffolds as Array<any>).find(
      ({ name }) => name === scaffoldBasicsList[selectedIndex].name,
    ),
  );
  if (!scaffold.success) {
    logger.error(
      "Failed to parse scaffold data. This is likely due to outdated LM Studio Version.",
    );
    logger.error("Please update LM Studio from https://lmstudio.ai");
    logger.debug(scaffold.error);
    process.exit(1);
  }

  await createWithScaffold(logger, scaffold.data);
});

async function selectScaffold(
  scaffoldBasicsList: Array<ScaffoldBasicsList>,
  searchKeys: Array<string>,
  initialSearch: string,
  leaveEmptyLines: number,
) {
  const pageSize = terminalSize().rows - leaveEmptyLines - 3;
  return await runPromptWithExitHandling(() =>
    search<number>(
      {
        message: chalk.green("Select a scaffold to use") + chalk.dim(" |"),
        pageSize,
        theme: searchTheme,
        source: async (inputValue: string | undefined, { signal }: { signal: AbortSignal }) => {
          void signal;
          const searchTerm = inputValue ?? initialSearch;
          const options = fuzzy.filter(searchTerm, searchKeys, fuzzyHighlightOptions);
          return options.map(option => {
            const scaffoldBasics = scaffoldBasicsList[option.index];
            const parenthesisIndex = option.string.lastIndexOf("(");
            const colored =
              option.string.slice(0, parenthesisIndex) +
              chalk.dim(option.string.slice(parenthesisIndex));
            return {
              value: option.index,
              short: scaffoldBasics.displayName,
              name: colored,
              description: scaffoldBasics.description,
            };
          });
        },
      },
      { output: process.stderr },
    ),
  );
}

class Replacer {
  private readonly replaces: Array<{
    from: string;
    to: string;
  }> = [];
  public addReplace(from: string, to: string) {
    this.replaces.push({ from, to });
  }
  public replace(text: string) {
    for (const { from, to } of this.replaces) {
      text = text.replaceAll(from, to);
    }
    return text;
  }
}

async function createWithScaffold(logger: SimpleLogger, scaffold: Scaffold) {
  let projectNameIndex = -1;
  for (const [index, arg] of scaffold.args.entries()) {
    if (arg.isProjectName === true) {
      projectNameIndex = index;
      break;
    }
  }
  if (projectNameIndex === -1) {
    throw new Error("No project name argument found in scaffold.");
  }
  const replacer = new Replacer();
  let projectName: string = "project";
  for (const arg of scaffold.args) {
    const { name, replaceFrom, default: originalDefaultValue } = arg;
    const defaultValue = replacer.replace(originalDefaultValue);

    const value = await runPromptWithExitHandling(() =>
      promptInput(
        {
          message: `${name}`,
          default: defaultValue === "" ? undefined : defaultValue,
        },
        { output: process.stderr },
      ),
    );

    if (arg.isProjectName === true) {
      projectName = value;
    }

    for (const src of replaceFrom ?? []) {
      replacer.addReplace(src, value);
    }
  }

  if (illegalPaths.includes(projectName)) {
    logger.error(`The project name "${projectName}" is not allowed.`);
    process.exit(1);
  }

  for (const char of illegalPathChars) {
    if (projectName.includes(char)) {
      logger.error(`The project name "${projectName}" contains illegal character "${char}".`);
      process.exit(1);
    }
  }

  if (existsSync(projectName)) {
    logger.error(`The directory/file "${projectName}" already exists.`);
    process.exit(1);
  }

  logger.info("Checking requirements...");
  if (!(await checkIfCommandExists(logger, "node"))) {
    logger.error("Node.js is required to create this project.");
    logger.error("Please install Node.js from https://nodejs.org/");
    process.exit(1);
  }
  if (!(await checkIfCommandExists(logger, "npm"))) {
    logger.error("npm is required to create this project.");
    logger.error("Please install Node.js from https://nodejs.org/");
    process.exit(1);
  }

  const tempDir = tmpdir();

  logger.info("Downloading necessary files...");

  const tarballName = await new Promise<string>((resolve, reject) => {
    let stdout = "";
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", `@lmstudio/scaffold-${scaffold.name}@latest`, "--prefer-online"],
      { cwd: tempDir, shell: true },
    );
    child.stdout.on("data", data => {
      const str = data.toString();
      stdout += str;
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`npm install exited with code ${code}`));
      }
    });
  });

  logger.debug("tarballName is", tarballName);
  logger.info("Extracting files...");

  await mkdir(projectName, { recursive: true });

  // Bun bug workaround: https://github.com/oven-sh/bun/issues/12696
  const needTarWorkaround =
    typeof (globalThis as any).Bun !== "undefined" && process.platform === "win32";
  if (needTarWorkaround) process.env.__FAKE_PLATFORM__ = "linux";
  const tar = require("tar");
  if (needTarWorkaround) delete process.env.__FAKE_PLATFORM__;

  await tar.extract({
    file: `${tempDir}/${tarballName}`,
    cwd: projectName,
    strip: 1,
  });

  unlink(`${tempDir}/${tarballName}`);

  logger.info("Initializing project...");

  const files = await fg([`./${projectName}/**/*`, `!./${projectName}/node_modules/**/*`], {
    dot: true,
  });
  logger.debug(`Found ${files.length} files to replace`);

  const progressBar = new ProgressBar();

  for (const [index, file] of files.entries()) {
    const content = await readFile(file, "utf8");
    const replaced = replacer.replace(content);
    await writeFile(file, replaced, "utf8");
    progressBar.setRatio((index + 1) / files.length);
  }

  progressBar.stop();

  logger.info("Installing dependencies...");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], {
      cwd: projectName,
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${code}`));
      }
    });
  });

  logger.info("Finalizing...");

  const packageJsonPath = `./${projectName}/package.json`;
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.version = "0.0.0";
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");

  await rm(`${projectName}/lms-scaffold.json`);

  if (scaffold.renames !== undefined) {
    for (let { from, to } of scaffold.renames) {
      from = join(projectName, replacer.replace(from));
      to = join(projectName, replacer.replace(to));
      await rename(from, to);
    }
  }

  logger.info("\nProject initialized.");

  const motdLines = [];

  for (const { type, text } of scaffold.motd) {
    const message = replacer
      .replace(text)
      .replaceAll("<hl>", ANSI_CYAN)
      .replaceAll("</hl>", ANSI_RESET_COLOR);
    switch (type) {
      case "title":
        motdLines.push(chalk.green(`  ${message}  `));
        break;
      case "regular":
        motdLines.push(message);
        break;
      case "command":
        motdLines.push(
          message
            .trim()
            .split("\n")
            .map(msg => "    " + chalk.yellow(msg))
            .join("\n"),
        );
        break;
      case "hint":
        motdLines.push(chalk.dim(message));
        break;
    }
  }

  logger.infoWithoutPrefix(motdLines.join("\n"));
}

export const create = createCommand;
