import { Command, type OptionValues } from "@commander-js/extra-typings";
import chalk from "chalk";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../createClient.js";
import { type LMStudioClient } from "@lmstudio/sdk";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../logLevel.js";

/**
 * Gets the version information of the LM Studio instance the client is connected to.
 * If there is no instance LM Studio connected, we try to wake it up and if not,
 * the waking up fails, and we return with errors anyway so don't need to handle
 * that here.
 */
export async function getVersionInfo(client: LMStudioClient) {
  const version = await client.system.getLMStudioVersion();
  const daemonInfo = await client.system.getInfo();
  const isDaemon = daemonInfo.isDaemon;
  const target = isDaemon ? "llmster" : "LM Studio";
  return {
    version: version.version,
    build: version.build,
    target,
    cliCommitHash: getCommitHash(),
  };
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
  printLmsInformationWithVerison();
  const versionInfo = await getVersionInfo(client);
  console.info();
  const targetColor =
    versionInfo.target === "llmster"
      ? chalk.green(versionInfo.target)
      : chalk.magenta(versionInfo.target);
  console.info(
    chalk.blue(`Using with: ${targetColor} (`) +
      chalk.cyan(`v${versionInfo.version} build ${versionInfo.build}`) +
      chalk.blue(")"),
  );
  console.info(
    chalk.blue("CLI Version: ") + chalk.gray("commit ") + chalk.cyan(versionInfo.cliCommitHash),
  );
  console.info(chalk.blue("Docs: https://lmstudio.ai/docs/developer"));
  console.info(chalk.blue("Join our Discord: https://discord.gg/lmstudio"));
  console.info(chalk.blue("Contribute: https://github.com/lmstudio-ai/lms"));
}

export async function printLmsInformationWithVerison(
  showTargetInfo = false,
  client?: LMStudioClient,
) {
  console.info();
  console.info(
    chalk.blue("lms") +
      " is LM Studio's CLI utility for your models, server, and inference runtime.",
  );
  if (showTargetInfo && client !== undefined) {
    const versionInfo = await getVersionInfo(client);
    const targetColor =
      versionInfo.target === "llmster"
        ? chalk.green(versionInfo.target)
        : chalk.magenta(versionInfo.target);
    console.info(
      `Using with: ${targetColor} (${chalk.cyan(`v${versionInfo.version} build ${versionInfo.build}`)})`,
    );
    console.info(`CLI commit: ${chalk.cyan(versionInfo.cliCommitHash)}`);
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
    const versionInfo = await getVersionInfo(client);
    console.info(
      JSON.stringify({
        target: versionInfo.target,
        version: versionInfo.version,
        build: versionInfo.build,
        cliCommitHash: versionInfo.cliCommitHash,
      }),
    );
  } else {
    await printVersionWithLogo(client);
  }
});
