import { Command, type OptionValues } from "@commander-js/extra-typings";
import { checkbox, input as promptInput } from "@inquirer/prompts";
import { text } from "@lmstudio/lms-common";
import chalk from "chalk";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
import { runPromptWithExitHandling } from "../prompt.js";
import { skillMetadataSchema } from "../skills/types.js";

type InitCommandOptions = OptionValues &
  LogLevelArgs & {
    description?: string;
    license?: string;
    scripts?: boolean;
    references?: boolean;
    assets?: boolean;
  };

const initCommand = new Command<[], InitCommandOptions>()
  .name("init")
  .description("Initialize a new Agent Skill (agentskills.io format)")
  .argument("[name]", "Skill name (lowercase, hyphens only)")
  .option("-d, --description <description>", "Skill description")
  .option("-l, --license <license>", "License for the skill")
  .option("--scripts", "Include scripts/ directory")
  .option("--references", "Include references/ directory")
  .option("--assets", "Include assets/ directory");

addLogLevelOptions(initCommand);

initCommand.action(async (nameArg: string | undefined, options: InitCommandOptions) => {
  const logger = createLogger(options);

  // Resolve skill name
  const name = await resolveName(nameArg, logger);

  // Validate name
  const nameResult = skillMetadataSchema.shape.name.safeParse(name);
  if (!nameResult.success) {
    logger.error(
      `Invalid skill name "${name}": ${nameResult.error.issues[0]?.message ?? "Invalid"}`,
    );
    process.exit(1);
  }

  // Check if directory already exists
  const skillDir = resolve(name);
  if (existsSync(skillDir)) {
    logger.error(`Directory "${name}" already exists.`);
    process.exit(1);
  }

  // Resolve description
  const description = await resolveDescription(options.description, logger);

  // Resolve optional directories
  let includeDirs: string[] = [];
  const hasExplicitFlags =
    options.scripts === true || options.references === true || options.assets === true;

  if (hasExplicitFlags) {
    if (options.scripts === true) includeDirs.push("scripts");
    if (options.references === true) includeDirs.push("references");
    if (options.assets === true) includeDirs.push("assets");
  } else if (process.stdin.isTTY) {
    includeDirs = await runPromptWithExitHandling(() =>
      checkbox(
        {
          message: "Include optional directories",
          choices: [
            { name: "scripts/  - Executable code agents can run", value: "scripts" },
            { name: "references/  - Additional documentation", value: "references" },
            { name: "assets/  - Templates and static resources", value: "assets" },
          ],
        },
        { output: process.stderr },
      ),
    );
  }

  // Resolve license
  let license: string | undefined = options.license;
  if (license === undefined && process.stdin.isTTY) {
    license = await runPromptWithExitHandling(() =>
      promptInput(
        {
          message: "License (optional, press Enter to skip)",
          default: "",
        },
        { output: process.stderr },
      ),
    );
    if (license === "") license = undefined;
  }

  // Create directory structure
  await mkdir(skillDir, { recursive: true });
  for (const dir of includeDirs) {
    await mkdir(join(skillDir, dir), { recursive: true });
  }

  // Build SKILL.md content
  const displayName = name
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  let frontmatter = `---\nname: ${name}\ndescription: ${description}\n`;
  if (license !== undefined) {
    frontmatter += `license: ${license}\n`;
  }
  frontmatter += `---`;

  const skillMdContent = `${frontmatter}

# ${displayName}

## When to use this skill

Use this skill when...

## Instructions

1. Step one...
2. Step two...

## Examples

### Example input

...

### Example output

...
`;

  await writeFile(join(skillDir, "SKILL.md"), skillMdContent, "utf-8");

  // Print success
  logger.info("");
  logger.infoWithoutPrefix(chalk.green(`  Created skill at ./${name}/`));
  logger.infoWithoutPrefix("");
  logger.infoWithoutPrefix(`    ${chalk.bold("SKILL.md")}          Skill instructions (edit this!)`);
  for (const dir of includeDirs) {
    const desc =
      dir === "scripts"
        ? "Executable scripts"
        : dir === "references"
          ? "Reference documentation"
          : "Templates and resources";
    logger.infoWithoutPrefix(`    ${chalk.bold(dir + "/")}${" ".repeat(14 - dir.length)}${desc}`);
  }
  logger.infoWithoutPrefix("");
  logger.infoWithoutPrefix(
    text`  ${chalk.dim("Edit SKILL.md to add your skill's instructions.")}`,
  );
  logger.infoWithoutPrefix(
    text`  ${chalk.dim("Spec: https://agentskills.io/specification")}`,
  );
});

async function resolveName(
  nameArg: string | undefined,
  logger: { error: (...args: Array<unknown>) => void },
): Promise<string> {
  if (nameArg !== undefined && nameArg !== "") {
    return nameArg;
  }
  if (process.stdin.isTTY) {
    return await runPromptWithExitHandling(() =>
      promptInput(
        {
          message: "Skill name (lowercase, hyphens only)",
          validate: (value: string) => {
            const result = skillMetadataSchema.shape.name.safeParse(value);
            return result.success ? true : result.error.issues[0]?.message ?? "Invalid name";
          },
        },
        { output: process.stderr },
      ),
    );
  }
  logger.error("Skill name is required. Usage: lms init <name>");
  throw process.exit(1);
}

async function resolveDescription(
  descOption: string | undefined,
  logger: { error: (...args: Array<unknown>) => void },
): Promise<string> {
  if (descOption !== undefined && descOption !== "") {
    return descOption;
  }
  if (process.stdin.isTTY) {
    return await runPromptWithExitHandling(() =>
      promptInput(
        {
          message: "Description (what this skill does and when to use it)",
          validate: (value: string) => {
            if (value.trim().length === 0) return "Description is required";
            if (value.length > 1024) return "Description must be 1024 characters or fewer";
            return true;
          },
        },
        { output: process.stderr },
      ),
    );
  }
  logger.error("Description is required. Use --description <desc>");
  throw process.exit(1);
}

export const init = initCommand;
