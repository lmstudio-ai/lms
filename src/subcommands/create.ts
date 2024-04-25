import { filteredArray, type SimpleLogger } from "@lmstudio/lms-common";
import boxen from "boxen";
import chalk from "chalk";
import { exec, spawn } from "child_process";
import { command, optional, positional, string } from "cmd-ts";
import fg from "fast-glob";
import { existsSync } from "fs";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "fs/promises";
import fuzzy from "fuzzy";
import inquirer from "inquirer";
import inquirerPrompt from "inquirer-autocomplete-prompt";
import { tmpdir } from "os";
import { join } from "path";
import * as tar from "tar";
import util from "util";
import { z } from "zod";
import { createLogger, logLevelArgs } from "../logLevel";
import { ProgressBar } from "../ProgressBar";
import terminalSize from "../terminalSize";

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

async function getScaffolds(logger: SimpleLogger) {
  const url = "https://scaffolds-manifest.lmstudio.ai";
  const response = await fetch(url);
  const json = await response.json();
  if (!Array.isArray(json)) {
    throw new Error("Invalid response from the server.");
  }

  return json as Array<unknown>;
}

export const create = command({
  name: "create",
  description: "Create a new project with scaffolding",
  args: {
    ...logLevelArgs,
    scaffold: positional({
      type: optional(string),
      displayName: "scaffold",
    }),
  },
  handler: async args => {
    const logger = createLogger(args);
    const { scaffold: scaffoldName } = args;
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

    // Try exact match first.
    let selectedIndex = scaffoldBasicsList.findIndex(({ name }) => name === scaffoldName);

    const searchKeys = scaffoldBasicsList.map(({ name, displayName }) => {
      return `${displayName} (${name})`;
    });
    if (selectedIndex === -1) {
      console.info();
      if (scaffoldName === undefined) {
        selectedIndex = await selectScaffold(scaffoldBasicsList, searchKeys, "", 5);
      } else {
        // const initialFilteredResults = fuzzy.filter(scaffold, searchKeys);
        selectedIndex = await selectScaffold(scaffoldBasicsList, searchKeys, scaffoldName, 5);
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
  },
});

async function selectScaffold(
  scaffoldBasicsList: Array<ScaffoldBasicsList>,
  searchKeys: Array<string>,
  initialSearch: string,
  leaveEmptyLines: number,
) {
  inquirer.registerPrompt("autocomplete", inquirerPrompt);
  console.info(chalk.gray("! Please select a scaffold from the list below."));
  console.info(
    chalk.gray("! use the arrow keys to navigate, type to filter, and press enter to select."),
  );
  console.info();
  const { selected } = await inquirer.prompt({
    type: "autocomplete",
    name: "selected",
    message: chalk.greenBright("Select a scaffold to use") + chalk.gray(" |"),
    initialSearch,
    loop: false,
    pageSize: terminalSize().rows - leaveEmptyLines,
    emptyText: "No scaffold matched the filter",
    source: async (_: any, input: string) => {
      const options = fuzzy.filter(input ?? "", searchKeys, {
        pre: "\x1b[91m",
        post: "\x1b[39m",
      });
      return options.map(option => {
        input = input.split("(").join("");
        const scaffoldBasics = scaffoldBasicsList[option.index];
        const parenIndex = option.string.lastIndexOf("(");
        const colored =
          option.string.slice(0, parenIndex) + chalk.gray(option.string.slice(parenIndex));
        return {
          value: option.index,
          short: scaffoldBasics.displayName,
          name: colored,
          description: scaffoldBasics.description,
        };
      });
    },
  } as any);
  return selected as number;
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
    if (arg.isProjectName) {
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

    const { value } = await inquirer.prompt({
      type: "input",
      name: "value",
      message: `${name}`,
      default: defaultValue,
    });

    if (arg.isProjectName) {
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
      ["pack", `@lmstudio/scaffold-${scaffold.name}@latest`],
      { cwd: tempDir },
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

  logger.info("Project initialized.");

  const motdLines = [];

  for (const { type, text } of scaffold.motd) {
    const message = replacer
      .replace(text)
      .replaceAll("<hl>", "\x1b[96m")
      .replaceAll("</hl>", "\x1b[39m");
    switch (type) {
      case "title":
        motdLines.push(chalk.bgGreenBright.black(`  ${message}  `));
        break;
      case "regular":
        motdLines.push(message);
        break;
      case "command":
        motdLines.push(
          message
            .trim()
            .split("\n")
            .map(msg => "    " + chalk.yellowBright(msg))
            .join("\n"),
        );
        break;
      case "hint":
        motdLines.push(chalk.gray(message));
        break;
    }
  }

  logger.infoWithoutPrefix(
    boxen(motdLines.join("\n\n"), {
      padding: 1,
      margin: 1,
      borderColor: "greenBright",
    }),
  );
}
