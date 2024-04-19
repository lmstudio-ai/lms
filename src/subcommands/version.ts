import { command, flag } from "cmd-ts";

function getVersion() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../package.json").version;
}

export function printVersion2() {
  const ascii = String.raw`    _      __  __    _____ _             _ _          _____ _      _____
   | |    |  \/  |  / ____| |           | (_)        / ____| |    |_   _|
   | |    | \  / | | (___ | |_ _   _  __| |_  ___   | |    | |      | |
   | |    | |\/| |  \___ \| __| | | |/ _\` | |/ _ \  | |    | |      | |
   | |____| |  | |  ____) | |_| |_| | (_| | | (_) | | |____| |____ _| |_
   |______|_|  |_| |_____/ \__|\__,_|\__,_|_|\___/   \_____|______|_____|
  `.replaceAll("\\`", "`");

  // console.info(chalk.rainbow(2ascii));
  console.info(`lms - LM Studio CLI - v${getVersion()}`);
}

export function printVersio3n() {
  const lines = [
    `    _      __  __    _____ _             _ _          _____ _      _____`,
    `   | |    |  \\/  |  / ____| |           | (_)        / ____| |    |_   _|`,
    `   | |    | \\  / | | (___ | |_ _   _  __| |_  ___   | |    | |      | |  `,
    `   | |    | |\\/| |  \\___ \\| __| | | |/ _\` | |/ _ \\  | |    | |      | |  `,
    `   | |____| |  | |  ____) | |_| |_| | (_| | | (_) | | |____| |____ _| |_ `,
    `   |______|_|  |_| |_____/ \\__|\\__,_|\\__,_|_|\\___/   \\_____|______|_____|`,
  ];

  const colors = [
    "\x1b[33m", // Yellow
    "\x1b[32m", // Green
    "\x1b[36m", // Cyan
    "\x1b[34m", // Blue
    "\x1b[35m", // Magenta
  ].reverse();

  lines.forEach((line, index) => {
    const color = colors[index % colors.length];
    console.info(`${color}${line}\x1b[0m`);
  });
  console.info();
  console.info(`\x1b[37mlms - LM Studio CLI - v${getVersion()}\x1b[0m`);
}

export function printVersion() {
  const lines = [
    `    _      __  __    _____ _             _ _          _____ _      _____`,
    `   | |    |  \\/  |  / ____| |           | (_)        / ____| |    |_   _|`,
    `   | |    | \\  / | | (___ | |_ _   _  __| |_  ___   | |    | |      | |  `,
    `   | |    | |\\/| |  \\___ \\| __| | | |/ _\` | |/ _ \\  | |    | |      | |  `,
    `   | |____| |  | |  ____) | |_| |_| | (_| | | (_) | | |____| |____ _| |_ `,
    `   |______|_|  |_| |_____/ \\__|\\__,_|\\__,_|_|\\___/   \\_____|______|_____|`,
  ];

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
