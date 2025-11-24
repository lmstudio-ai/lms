import {
  Option,
  program,
  type CommandUnknownOpts,
  type HelpConfiguration,
} from "@commander-js/extra-typings";
import chalk from "chalk";
import { bootstrap } from "./subcommands/bootstrap.js";
import { chat } from "./subcommands/chat/index.js";
import { clone } from "./subcommands/clone.js";
import { create } from "./subcommands/create.js";
import { daemon } from "./subcommands/daemon.js";
import { dev } from "./subcommands/dev/index.js";
import { flags } from "./subcommands/flags.js";
import { get } from "./subcommands/get.js";
import { importCmd } from "./subcommands/importCmd.js";
import { ls, ps } from "./subcommands/list.js";
import { load } from "./subcommands/load.js";
import { log } from "./subcommands/log.js";
import { login } from "./subcommands/login.js";
import { push } from "./subcommands/push.js";
import { runtime } from "./subcommands/runtime/index.js";
import { server } from "./subcommands/server.js";
import { status } from "./subcommands/status.js";
import { unload } from "./subcommands/unload.js";
import { getVersion, printVersionCompact, version } from "./subcommands/version.js";
import { UserInputError } from "./types/UserInputError.js";

if (process.argv.length === 2) {
  printVersionCompact();
  console.info();
}

const HELP_MESSAGE_PADDING_LEFT = 1;
const HELP_MESSAGE_MAX_WIDTH = 90;
const HELP_MESSAGE_GAP = 10;
const SUBCOMMAND_HELP_MESSAGE_MAX_WIDTH = 130;
const SUBCOMMAND_HELP_MESSAGE_GAP = 3;
const commandColorByName = new Map<string, string | undefined>();

function formatCommandTerm(commandName: string, helpMessageGap: number): string {
  const color = commandColorByName.get(commandName);
  const formatter =
    color === undefined
      ? (text: string) => chalk.bold(text)
      : (text: string) => chalk.bold.hex(color)(text);
  return formatter(
    `${" ".repeat(HELP_MESSAGE_PADDING_LEFT)}${commandName.padEnd(
      commandName.length + helpMessageGap,
    )}`,
  );
}

function addCommandsGroup(
  title: string,
  commands: Array<CommandUnknownOpts>,
  colorHex?: string | null,
): void {
  const commandColor = colorHex ?? undefined;
  commands.forEach(command => {
    commandColorByName.set(command.name(), commandColor);
  });
  const groupTitle = chalk.bold(title);
  program.commandsGroup(groupTitle);
  commands.forEach(command => {
    program.addCommand(command);
  });
}

function createHelpConfiguration(
  maxWidth: number,
  helpMessageGap: number,
): HelpConfiguration {
  return {
    helpWidth: maxWidth,
    commandUsage: command => chalk.bold(`${command.name()} ${command.usage()}`),
    subcommandTerm: (command: { name(): string }) =>
      formatCommandTerm(command.name(), helpMessageGap),
    subcommandDescription: (command: { description(): string }) => command.description(),
    visibleOptions: command =>
      command.options.filter(
        option => option.long !== "--help" && option.short !== "-h" && option.hidden !== true,
      ),
    optionTerm: (option: { flags: string }) =>
      chalk.cyan(
        `${" ".repeat(HELP_MESSAGE_PADDING_LEFT)}${option.flags.padEnd(
          option.flags.length + helpMessageGap,
        )}`,
      ),
    optionDescription: (option: { description?: string }) => option.description ?? "",
    argumentTerm: (argument: { name(): string }) =>
      `${argument.name()}`.padStart(HELP_MESSAGE_PADDING_LEFT + argument.name().length, " "),
    argumentDescription: (argument: { description?: string }) => argument.description ?? "",
  };
}

const rootHelpConfig = createHelpConfiguration(HELP_MESSAGE_MAX_WIDTH, HELP_MESSAGE_GAP);
const subcommandHelpConfig = createHelpConfiguration(
  SUBCOMMAND_HELP_MESSAGE_MAX_WIDTH,
  SUBCOMMAND_HELP_MESSAGE_GAP,
);

interface HelpConfigurableCommand {
  commands: ReadonlyArray<CommandUnknownOpts>;
  configureHelp(helpConfiguration: HelpConfiguration): void;
}

function applyHelpConfigurationRecursively(
  commandToConfigure: HelpConfigurableCommand,
  commandHelpConfig: HelpConfiguration,
  nestedHelpConfig: HelpConfiguration,
): void {
  commandToConfigure.configureHelp(commandHelpConfig);
  const subcommands = commandToConfigure.commands;
  for (const subcommand of subcommands) {
    applyHelpConfigurationRecursively(subcommand, nestedHelpConfig, nestedHelpConfig);
  }
}

program.name("lms");
program.helpCommand(false);

// Add a hidden global version option (-v/--version) that prints and exits without cluttering help
program.addOption(new Option("-v, --version", "Print the version of the CLI").hideHelp());
program.on("option:version", () => {
  console.info(getVersion());
  process.exit(0);
});
program.addHelpText(
  "after",
  `
Learn more:           ${chalk.blue("https://lmstudio.ai/docs/developer")}
Join our Discord:     ${chalk.blue("https://discord.gg/lmstudio")}`,
);

addCommandsGroup("Local models", [chat, get, load, unload, ls, ps, importCmd], "#22D3EE");
addCommandsGroup("Serve", [server, log], "#34D399");
addCommandsGroup("Runtime", [runtime], "#C084FC");
addCommandsGroup("Develop & Publish (Beta)", [clone, push, dev, login], "#F9A8D4");

program.addCommand(create, { hidden: true });
program.addCommand(bootstrap, { hidden: true });
program.addCommand(daemon, { hidden: true });
program.addCommand(flags, { hidden: true });
program.addCommand(status, { hidden: true });
program.addCommand(version, { hidden: true });

applyHelpConfigurationRecursively(program, rootHelpConfig, subcommandHelpConfig);

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof UserInputError) {
    // Omit stack trace for UserInputErrors
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
