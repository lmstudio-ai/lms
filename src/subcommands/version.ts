import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { t } from "../i18n/index.js";

export function getCommitHash() {
  return "<LMS-CLI-COMMIT-HASH>";
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
  printVersionCompact();
  console.info();
  // The label is translated while the URL itself is left untouched so the link stays intact.
  console.info(chalk.blue(`${t("Docs:")} https://lmstudio.ai/docs/developer`));
  console.info(chalk.blue(`${t("Join our Discord:")} https://discord.gg/lmstudio`));
  console.info(chalk.blue(`${t("Contribute:")} https://github.com/lmstudio-ai/lms`));
}

export function printVersionCompact() {
  console.info(
    chalk.blue("lms"),
    t(`is LM Studio's CLI utility for your models, server, and inference runtime.`),
  );
  console.info(chalk.dim(t("CLI commit:")), chalk.cyan(getCommitHash()));
}

export const version = new Command()
  .name("version")
  .description(t("Prints the version of the CLI"))
  .option("--json", t("Prints the version in JSON format"))
  .action(async options => {
    const { json = false } = options;
    if (json) {
      console.info(JSON.stringify({ version: getCommitHash() }));
    } else {
      printVersionWithLogo();
    }
  });
