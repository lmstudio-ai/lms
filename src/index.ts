import { Option, program, type HelpConfiguration } from "@commander-js/extra-typings";
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

const helpConfig: HelpConfiguration = {
  helpWidth: HELP_MESSAGE_MAX_WIDTH,
  subcommandTerm: (cmd: { name(): string }) =>
    `${" ".repeat(HELP_MESSAGE_PADDING_LEFT)}${cmd.name().padEnd(cmd.name().length + HELP_MESSAGE_GAP)}`,
  subcommandDescription: (cmd: { description(): string }) => cmd.description(),
  visibleOptions: command =>
    command.options.filter(
      option => option.long !== "--help" && option.short !== "-h" && option.hidden !== true,
    ),
  optionTerm: (option: { flags: string }) =>
    `${" ".repeat(HELP_MESSAGE_PADDING_LEFT)}${option.flags.padEnd(option.flags.length + HELP_MESSAGE_GAP)}`,
  optionDescription: (option: { description?: string }) => option.description ?? "",
  argumentTerm: (arg: { name(): string }) =>
    `${arg.name()}`.padStart(HELP_MESSAGE_PADDING_LEFT + arg.name().length, " "),
  argumentDescription: (arg: { description?: string }) => arg.description ?? "",
};

program.name("lms");
program.configureHelp(helpConfig);
program.helpCommand(false);
program.helpOption(false);

// Re-add a hidden help option so `-h/--help` still works without showing in help output
program.addOption(new Option("-h, --help", "display help for command").hideHelp());
program.on("option:help", () => {
  program.help({ error: false });
});

// Add a hidden global version option (-v/--version) that prints and exits without cluttering help
program.addOption(new Option("-v, --version", "Print the version of the CLI").hideHelp());
program.on("option:version", () => {
  console.info(getVersion());
  process.exit(0);
});

program.addHelpText(
  "after", `
Learn more:           https://lmstudio.ai/docs/developer
Join our Discord:     https://discord.gg/lmstudio`
);

program.commandsGroup("Manage Models");
program.addCommand(get);
program.addCommand(importCmd);
program.addCommand(ls);

program.commandsGroup("Use Models");
program.addCommand(chat);
program.addCommand(load);
program.addCommand(ps);
program.addCommand(server);
program.addCommand(unload);

program.commandsGroup("Develop & Publish Artifacts");
program.addCommand(clone);
program.addCommand(create);
program.addCommand(dev);
program.addCommand(login);
program.addCommand(push);

program.commandsGroup("System Management");
program.addCommand(bootstrap, { hidden: true });
program.addCommand(daemon, { hidden: true });
program.addCommand(flags);
program.addCommand(log);
program.addCommand(runtime);
program.addCommand(status);
program.addCommand(version);

program.parseAsync(process.argv).catch((error: any) => {
  if (error instanceof UserInputError) {
    // Omit stack trace for UserInputErrors
    console.error(error.message);
  } else {
    console.error(error?.stack ?? error);
  }
  process.exit(1);
});
