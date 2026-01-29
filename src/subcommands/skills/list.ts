import { Command, type OptionValues } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { getCliPref } from "../../cliPref.js";
import { defaultSkillsFolderPath } from "../../lmstudioPaths.js";
import { discoverSkills } from "../../skills/discovery.js";

type ListCommandOptions = OptionValues &
  LogLevelArgs & {
    dir?: string;
  };

const listCommand = new Command<[], ListCommandOptions>()
  .name("ls")
  .description("List discovered skills")
  .option("--dir <directory>", "Skill directory to scan (overrides configured directories)");

addLogLevelOptions(listCommand);

listCommand.action(async (options: ListCommandOptions) => {
  const logger = createLogger(options);

  let directories: string[];
  if (options.dir !== undefined) {
    directories = [options.dir];
  } else {
    const cliPref = await getCliPref(logger);
    directories = cliPref.get().skillsDirectories ?? [defaultSkillsFolderPath];
  }

  logger.debug(`Scanning directories: ${directories.join(", ")}`);
  const skills = await discoverSkills(directories, logger);

  if (skills.length === 0) {
    logger.info("No skills found.");
    logger.info("");
    logger.infoWithoutPrefix(
      chalk.dim(`  Searched: ${directories.join(", ")}`),
    );
    logger.infoWithoutPrefix(
      chalk.dim(`  Create a skill with: lms init <name>`),
    );
    return;
  }

  logger.info(`Found ${skills.length} skill${skills.length === 1 ? "" : "s"}:\n`);
  for (const skill of skills) {
    const extras: string[] = [];
    if (skill.hasScripts) extras.push("scripts");
    if (skill.hasReferences) extras.push("references");
    if (skill.hasAssets) extras.push("assets");
    const extrasStr = extras.length > 0 ? chalk.dim(` [${extras.join(", ")}]`) : "";

    logger.infoWithoutPrefix(`  ${chalk.bold.cyan(skill.metadata.name)}${extrasStr}`);
    logger.infoWithoutPrefix(`  ${chalk.dim(skill.metadata.description)}`);
    logger.infoWithoutPrefix(`  ${chalk.dim(skill.path)}`);
    logger.infoWithoutPrefix("");
  }
});

export const list = listCommand;
