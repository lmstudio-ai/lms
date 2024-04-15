import { command, flag } from "cmd-ts";

function getVersion() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../package.json").version;
}

export function printVersion() {
  const ascii = String.raw`    _      __  __    _____ _             _ _          _____ _      _____
   | |    |  \/  |  / ____| |           | (_)        / ____| |    |_   _|
   | |    | \  / | | (___ | |_ _   _  __| |_  ___   | |    | |      | |
   | |    | |\/| |  \___ \| __| | | |/ _\` | |/ _ \  | |    | |      | |
   | |____| |  | |  ____) | |_| |_| | (_| | | (_) | | |____| |____ _| |_
   |______|_|  |_| |_____/ \__|\__,_|\__,_|_|\___/   \_____|______|_____|
  `.replaceAll("\\`", "`");

  console.info(ascii);
  console.info(`lms - LM Studio CLI - v${getVersion()}`);
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
