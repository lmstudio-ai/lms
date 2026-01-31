import { Command, type OptionValues } from "@commander-js/extra-typings";
import chalk from "chalk";
import { existsSync } from "fs";
import { readFile, readdir, stat } from "fs/promises";
import { basename, join, resolve } from "path";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { parseSkillMd } from "../../skills/parser.js";

type ValidateCommandOptions = OptionValues & LogLevelArgs;

const validateCommand = new Command<[], ValidateCommandOptions>()
  .name("validate")
  .description("Validate a skill directory against the Agent Skills spec")
  .argument("<path>", "Path to skill directory");

addLogLevelOptions(validateCommand);

validateCommand.action(async (skillPath: string, options: ValidateCommandOptions) => {
  const logger = createLogger(options);
  const resolvedPath = resolve(skillPath);

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check directory exists
  if (!existsSync(resolvedPath)) {
    logger.error(`Path does not exist: ${resolvedPath}`);
    process.exit(1);
  }

  const stats = await stat(resolvedPath);
  if (!stats.isDirectory()) {
    logger.error(`Path is not a directory: ${resolvedPath}`);
    process.exit(1);
  }

  // Check SKILL.md exists
  const skillMdPath = join(resolvedPath, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    errors.push("Missing required file: SKILL.md");
  } else {
    try {
      const content = await readFile(skillMdPath, "utf-8");
      const { metadata, body } = parseSkillMd(content);

      // Check name matches directory
      const dirName = basename(resolvedPath);
      if (metadata.name !== dirName) {
        errors.push(
          `Skill name "${metadata.name}" does not match directory name "${dirName}"`,
        );
      }

      // Check body length
      const lineCount = body.split("\n").length;
      if (lineCount > 500) {
        warnings.push(
          `SKILL.md body is ${lineCount} lines (recommended: under 500). Consider moving content to references/`,
        );
      }

      if (body.trim().length === 0) {
        warnings.push("SKILL.md body is empty. Add instructions for agents.");
      }
    } catch (error) {
      if (error instanceof Error) {
        errors.push(`Failed to parse SKILL.md: ${error.message}`);
      } else {
        errors.push("Failed to parse SKILL.md");
      }
    }
  }

  // Check for unexpected files at root level
  const entries = await readdir(resolvedPath, { withFileTypes: true });
  const knownDirs = new Set(["scripts", "references", "assets"]);
  for (const entry of entries) {
    if (entry.isDirectory() && !knownDirs.has(entry.name)) {
      warnings.push(`Unexpected directory: ${entry.name}/`);
    }
  }

  // Print results
  if (errors.length === 0 && warnings.length === 0) {
    logger.infoWithoutPrefix(chalk.green(`  ✓ Valid skill at ${resolvedPath}`));
    return;
  }

  if (errors.length > 0) {
    logger.infoWithoutPrefix(chalk.red(`  ✗ Invalid skill at ${resolvedPath}\n`));
    for (const err of errors) {
      logger.infoWithoutPrefix(chalk.red(`    ✗ ${err}`));
    }
  } else {
    logger.infoWithoutPrefix(chalk.green(`  ✓ Valid skill at ${resolvedPath}`));
  }

  if (warnings.length > 0) {
    logger.infoWithoutPrefix("");
    for (const warn of warnings) {
      logger.infoWithoutPrefix(chalk.yellow(`    ⚠ ${warn}`));
    }
  }

  if (errors.length > 0) {
    process.exit(1);
  }
});

export const validate = validateCommand;
