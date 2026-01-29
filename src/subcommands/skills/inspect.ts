import { Command, type OptionValues } from "@commander-js/extra-typings";
import chalk from "chalk";
import { type Dirent, existsSync } from "fs";
import { readFile, readdir } from "fs/promises";
import { join, resolve } from "path";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { parseSkillMd, type ParsedSkillMd } from "../../skills/parser.js";

type InspectCommandOptions = OptionValues & LogLevelArgs;

const inspectCommand = new Command<[], InspectCommandOptions>()
  .name("inspect")
  .description("Show detailed information about a skill")
  .argument("<path>", "Path to skill directory");

addLogLevelOptions(inspectCommand);

inspectCommand.action(async (skillPath: string, options: InspectCommandOptions) => {
  const logger = createLogger(options);
  const resolvedPath = resolve(skillPath);

  if (!existsSync(resolvedPath)) {
    logger.error(`Path does not exist: ${resolvedPath}`);
    process.exit(1);
  }

  const skillMdPath = join(resolvedPath, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    logger.error(`No SKILL.md found at: ${resolvedPath}`);
    process.exit(1);
  }

  const content = await readFile(skillMdPath, "utf-8");
  const parsed = tryParse(content);
  if (parsed === undefined) {
    logger.error("Failed to parse SKILL.md. Run `lms skills validate` for details.");
    process.exit(1);
    return; // unreachable, helps TypeScript narrow types
  }

  const { metadata, body } = parsed;
  const lineCount = body.split("\n").length;
  const charCount = body.length;
  const estimatedTokens = Math.ceil(charCount / 4);

  logger.infoWithoutPrefix("");
  logger.infoWithoutPrefix(`  ${chalk.bold.cyan(metadata.name)}`);
  logger.infoWithoutPrefix(`  ${metadata.description}`);
  logger.infoWithoutPrefix("");

  logger.infoWithoutPrefix(`  ${chalk.dim("Path:")}         ${resolvedPath}`);
  if (metadata.license !== undefined) {
    logger.infoWithoutPrefix(`  ${chalk.dim("License:")}      ${metadata.license}`);
  }
  if (metadata.compatibility !== undefined) {
    logger.infoWithoutPrefix(`  ${chalk.dim("Compatibility:")} ${metadata.compatibility}`);
  }
  if (metadata["allowed-tools"] !== undefined) {
    logger.infoWithoutPrefix(`  ${chalk.dim("Allowed tools:")} ${metadata["allowed-tools"]}`);
  }
  if (metadata.metadata !== undefined) {
    for (const [key, value] of Object.entries(metadata.metadata)) {
      const pad = " ".repeat(Math.max(1, 13 - key.length));
      logger.infoWithoutPrefix(`  ${chalk.dim(`${key}:`)}${pad}${value}`);
    }
  }

  logger.infoWithoutPrefix("");
  logger.infoWithoutPrefix(
    `  ${chalk.dim("Body:")}         ${lineCount} lines, ${charCount} chars (~${estimatedTokens} tokens)`,
  );

  if (lineCount > 500) {
    logger.infoWithoutPrefix(
      chalk.yellow(
        `  Warning: Body exceeds recommended 500 lines. Consider moving content to references/`,
      ),
    );
  }

  const dirs = ["scripts", "references", "assets"];
  const presentDirs: string[] = [];
  for (const dir of dirs) {
    const dirPath = join(resolvedPath, dir);
    if (existsSync(dirPath)) {
      const entries = await readdir(dirPath);
      presentDirs.push(`${dir}/ (${entries.length} file${entries.length === 1 ? "" : "s"})`);
    }
  }

  if (presentDirs.length > 0) {
    logger.infoWithoutPrefix(`  ${chalk.dim("Directories:")}  ${presentDirs.join(", ")}`);
  }

  const rootEntries: Dirent[] = await readdir(resolvedPath, { withFileTypes: true });
  const otherFiles = rootEntries
    .filter(entry => entry.name !== "SKILL.md" && !dirs.includes(entry.name))
    .map(entry => (entry.isDirectory() ? entry.name + "/" : entry.name));
  if (otherFiles.length > 0) {
    logger.infoWithoutPrefix(`  ${chalk.dim("Other files:")}  ${otherFiles.join(", ")}`);
  }

  logger.infoWithoutPrefix("");
});

function tryParse(content: string): ParsedSkillMd | undefined {
  try {
    return parseSkillMd(content);
  } catch {
    return undefined;
  }
}

export const inspect = inspectCommand;
