import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";

export function getVersion() {
  return "<LMS-CLI-CURRENT-VERSION>";
}

export function printVersionWithLogo() {
  const lines = [
    String.raw`   __   __  ___  ______          ___        _______   ____`,
    String.raw`  / /  /  |/  / / __/ /___ _____/ (_)__    / ___/ /  /  _/`,
    String.raw` / /__/ /|_/ / _\ \/ __/ // / _  / / _ \  / /__/ /___/ /  `,
    String.raw`/____/_/  /_/ /___/\__/\_,_/\_,_/_/\___/  \___/____/___/  `,
  ];

  const colorCodes = [166, 214, 226, 46, 51, 141];

  lines.forEach((line, index) => {
    const colorCode = colorCodes[index % colorCodes.length];
    console.info(`\x1b[38;5;${colorCode}m${line}\x1b[0m`);
  });

  console.info();
  console.info(`lms - LM Studio CLI - v${getVersion()}`);
  console.info(chalk.gray("GitHub: https://github.com/lmstudio-ai/lms"));
}

export function printVersionCompact() {
  console.info(
    chalk.blue("lms"),
    `is LM Studio's CLI utility for your models, server, and inference runtime. (v${getVersion()})`,
  );
}

export const version = new Command()
  .name("version")
  .description("Prints the version of the CLI")
  .option("--json", "Prints the version in JSON format")
  .action(async options => {
    const { json = false } = options;
    if (json) {
      console.info(JSON.stringify({ version: getVersion() }));
    } else {
      printVersionWithLogo();
    }
  });
