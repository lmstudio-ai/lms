import {
  Option,
  program,
  type CommandUnknownOpts,
  type HelpConfiguration,
} from "@commander-js/extra-typings";
import chalk from "chalk";
import { resolve as resolvePath } from "path";
import { bootstrap } from "./subcommands/bootstrap.js";
import { chat } from "./subcommands/chat/index.js";
import { clone } from "./subcommands/clone.js";
import { create } from "./subcommands/create.js";
import { daemon } from "./subcommands/daemon/index.js";
import { dev } from "./subcommands/dev/index.js";
import { flags } from "./subcommands/flags.js";
import { get } from "./subcommands/get.js";
import { importCmd } from "./subcommands/importCmd.js";
import { link } from "./subcommands/link.js";
import { ls, ps } from "./subcommands/list.js";
import { load } from "./subcommands/load.js";
import { log } from "./subcommands/log.js";
import { login } from "./subcommands/login.js";
import { logout } from "./subcommands/logout.js";
import { push } from "./subcommands/push.js";
import { runtime } from "./subcommands/runtime/index.js";
import { server } from "./subcommands/server.js";
import { status } from "./subcommands/status.js";
import { unload } from "./subcommands/unload.js";
import { getCommitHash, printVersionCompact, version } from "./subcommands/version.js";
import { whoami } from "./subcommands/whoami.js";
import { UserInputError } from "./types/UserInputError.js";

const processArguments = process.argv.slice();
let commandArguments = processArguments.slice(2);

// If we don't pass in any arguments, in bun, the first argument is the path to the execPath.
// So we need to check for that and remove it.
if (commandArguments.length === 1) {
  try {
    const resolvedCandidatePath = resolvePath(commandArguments[0]);
    const resolvedExecPath = resolvePath(process.execPath);
    if (resolvedCandidatePath === resolvedExecPath) {
      commandArguments = [];
    }
  } catch {
    // If path resolution fails for any reason, fall back to the original arguments.
  }
}

if (commandArguments.length === 0) {
  printVersionCompact();
  console.info();
}

const HELP_MESSAGE_PADDING_LEFT = 1;
const HELP_MESSAGE_MAX_WIDTH = 90;
const HELP_MESSAGE_GAP = 10;
const commandColorByPath = new Map<string, string | undefined>();

function formatCommandTerm(command: CommandUnknownOpts, helpMessageGap: number): string {
  const commandPath = getCommandPath(command);
  const commandName = command.name();
  const color = commandColorByPath.get(commandPath);
  const paddedName = commandName.padEnd(commandName.length + helpMessageGap);
  const coloredName = color === undefined ? paddedName : chalk.hex(color)(paddedName);
  const boldName = chalk.bold(coloredName);
  return `${" ".repeat(HELP_MESSAGE_PADDING_LEFT)}${boldName}`;
}

function addCommandsGroup(
  title: string,
  commands: Array<CommandUnknownOpts>,
  colorHex?: string | null,
): void {
  const commandColor = colorHex ?? undefined;
  const groupTitle = chalk.bold(title);
  program.commandsGroup(groupTitle);
  commands.forEach(command => {
    program.addCommand(command);
    // After adding to program, we can compute the full path
    const commandPath = getCommandPath(command);
    commandColorByPath.set(commandPath, commandColor);
  });
}

type CommandWithOptionalParent = CommandUnknownOpts & { parent?: CommandUnknownOpts | null };

function getCommandPath(command: CommandUnknownOpts): string {
  const segments: Array<string> = [];
  let current: CommandWithOptionalParent | null | undefined = command as CommandWithOptionalParent;
  // Walk up the tree to include the program name in usage
  while (current !== undefined && current !== null) {
    segments.push(current.name());
    const parentCommand = current.parent;
    if (parentCommand === undefined || parentCommand === null) {
      break;
    }
    current = parentCommand as CommandWithOptionalParent;
  }
  return segments.reverse().join(" ");
}

function dimOptionParameters(flags: string, helpMessageGap: number): string {
  const dimmedFlags = flags.replace(/(<[^>]+>|\[[^\]]+\])/g, match => chalk.dim(match));
  return `${" ".repeat(HELP_MESSAGE_PADDING_LEFT)}${dimmedFlags.padEnd(
    flags.length + helpMessageGap,
  )}`;
}

function createHelpConfiguration(maxWidth: number, helpMessageGap: number): HelpConfiguration {
  return {
    helpWidth: maxWidth,
    commandUsage: command => chalk.bold(`${getCommandPath(command)} ${command.usage()}`),
    subcommandTerm: (command: CommandUnknownOpts) =>
      formatCommandTerm(command, helpMessageGap),
    subcommandDescription: (command: { description(): string }) => command.description(),
    visibleOptions: command =>
      command.options.filter(
        option => option.long !== "--help" && option.short !== "-h" && option.hidden !== true,
      ),
    optionTerm: (option: { flags: string }) =>
      chalk.cyan(dimOptionParameters(option.flags, helpMessageGap)),
    optionDescription: (option: { description?: string }) => option.description ?? "",
    argumentTerm: (argument: { name(): string }) => {
      const argumentName = argument.name();
      const paddedName = argumentName.padEnd(argumentName.length + helpMessageGap, " ");
      return `${" ".repeat(HELP_MESSAGE_PADDING_LEFT)}${paddedName}`;
    },
    argumentDescription: (argument: { description?: string }) => argument.description ?? "",
    visibleCommands(cmd) {
      // @ts-expect-error - Commander.js types don't include the _hidden property, but it exists at runtime
      return cmd.commands.filter(command => command._hidden !== true);
    },
  };
}

const rootHelpConfig = createHelpConfiguration(HELP_MESSAGE_MAX_WIDTH, HELP_MESSAGE_GAP);
const subcommandHelpConfig = rootHelpConfig;

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
program.helpCommand(true);

// Add a hidden global version option (-v/--version) that prints and exits without cluttering help
program.addOption(new Option("-v, --version", "Print the version of the CLI").hideHelp());
program.addHelpText(
  "after",
  `
Learn more:           ${chalk.blue("https://lmstudio.ai/docs/developer")}
Join our Discord:     ${chalk.blue("https://discord.gg/lmstudio")}`,
);

addCommandsGroup("Local models", [chat, get, load, unload, ls, ps, importCmd], "#22D3EE");
addCommandsGroup("Serve", [server, log], "#34D399");
addCommandsGroup("Runtime", [runtime], "#C084FC");
addCommandsGroup("Develop & Publish (Beta)", [clone, push, dev, login, logout, whoami], "#F9A8D4");

program.addCommand(create, { hidden: true });
program.addCommand(bootstrap, { hidden: true });
program.addCommand(daemon, { hidden: true });
program.addCommand(flags, { hidden: true });
program.addCommand(status, { hidden: true });
program.addCommand(version, { hidden: true });
program.addCommand(link, { hidden: true });

applyHelpConfigurationRecursively(program, rootHelpConfig, subcommandHelpConfig);

// Handle -v/--version before Commander parsing
if (commandArguments.includes("-v") || commandArguments.includes("--version")) {
  console.info("CLI commit: " + getCommitHash());
  process.exit(0);
}

// Here we manually pass in the arguments to avoid Commander.js's built-in parsing of process.argv
// which can interfere with our custom handling of no-argument case above.
//
// According to the docs, the first two are - the application as argv[0] and the script being run in
// argv[1].
// https://nodejs.org/docs/latest/api/process.html#processargv
await program.parseAsync(["node", "lms", ...commandArguments]).catch((error: unknown) => {
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
