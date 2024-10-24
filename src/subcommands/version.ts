import chalk from "chalk";
import { command, flag } from "cmd-ts";

function getVersion() {
  return "<LMS-CLI-CURRENT-VERSION>";
}

export function printVersion() {
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
  console.info(`\x1b[38;5;231mlms - LM Studio CLI - v${getVersion()}\x1b[0m`);
  // console.info("Licensed under the MIT License");
  console.info(chalk.gray("GitHub: https://github.com/lmstudio-ai/lmstudio-cli"));

  console.info(process.execPath);
}

export const version = command({
  name: "version",
  description: "Prints the version of the CLI",
  args: {
    json: flag({
      long: "json",
      description: "Prints the version in JSON format",
    }),
  },
  async handler({ json }) {
    if (json) {
      console.info(JSON.stringify({ version: getVersion() }));
    } else {
      printVersion();
    }
  },
});
