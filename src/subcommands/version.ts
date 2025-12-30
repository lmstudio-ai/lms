import { Command, type OptionValues } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { type LMStudioClient } from "@lmstudio/sdk";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";
export async function getVersion(client: LMStudioClient) {
  const version = await client.system.getLMStudioVersion();
  return `v${version.version} - build ${version.build}`;
}

export function getCommitHash() {
  return "<LMS-CLI-COMMIT-HASH>";
}

export async function printVersionWithLogo(client: LMStudioClient) {
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
  const version = await getVersion(client);
  const daemonInfo = await client.system.getInfo();
  console.info();
  const target = daemonInfo.isDaemon ? "llmster" : "LM Studio";
  const targetColor = daemonInfo.isDaemon ? chalk.green(target) : chalk.magenta(target);
  console.info(chalk.blue(`Using with: ${targetColor} (`) + chalk.cyan(version) + chalk.blue(")"));
  console.info(chalk.blue("CLI Version: ") + chalk.gray("commit ") + chalk.cyan(getCommitHash()));
  console.info(chalk.blue("Docs: https://lmstudio.ai/docs/developer"));
  console.info(chalk.blue("Join our Discord: https://discord.gg/lmstudio"));
  console.info(chalk.blue("Contribute: https://github.com/lmstudio-ai/lms"));
}

export function printVersionCompact(shouldShowCommitHash = false) {
  console.info();
  console.info(
    chalk.blue("lms") +
      " is LM Studio's CLI utility for your models, server, and inference runtime.",
  );
  if (shouldShowCommitHash) {
    console.info(chalk.dim(`CLI version: commit ${chalk.cyan(getCommitHash())}`));
  }
}

type VerisonCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    json?: true;
  };

export const version = new Command<[], VerisonCommandOptions>()
  .name("version")
  .description("Prints the version of the CLI")
  .option("--json", "Prints the version in JSON format");

addCreateClientOptions(version);
addLogLevelOptions(version);

version.action(async options => {
  const { json = false } = options;
  const logger = createLogger(options);
  await using client = await createClient(logger, options);
  if (json) {
    const targetVersion = await getVersion(client);
    const daemonInfo = await client.system.getInfo();
    const target = daemonInfo.isDaemon ? "llmster" : "LM Studio";
    const cliCommitHash = getCommitHash();
    console.info(JSON.stringify({ target, targetVersion, cliCommitHash }));
  } else {
    await printVersionWithLogo(client);
  }
});
