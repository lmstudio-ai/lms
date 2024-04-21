import { command, flag } from "cmd-ts";

function getVersion() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../package.json").version;
}

export function printVersion() {
  const lines = [
    `   __   __  ___  ______          ___        _______   ____`,
    `  / /  /  |/  / / __/ /___ _____/ (_)__    / ___/ /  /  _/`,
    ` / /__/ /|_/ / _\ \/ __/ // / _  / / _ \  / /__/ /___/ /  `,
    `/____/_/  /_/ /___/\__/\_,_/\_,_/_/\___/  \___/____/___/  `
  ]

  // Using a selection of softer color codes from the ANSI 256-color palette
  // const colorCodes = [39, 45, 51, 75, 69, 63]; // These codes correspond to lighter shades
  const colorCodes = [166, 214, 226, 46, 51, 141]; // Selected for a vivid rainbow effect

  lines.forEach((line, index) => {
    const colorCode = colorCodes[index % colorCodes.length];
    console.info(`\x1b[38;5;${colorCode}m${line}\x1b[0m`);
  });

  console.info();
  console.info(`\x1b[38;5;231mlms - LM Studio CLI - v${getVersion()}\x1b[0m`); // White for the version text
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
