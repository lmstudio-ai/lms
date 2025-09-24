import { program } from "@commander-js/extra-typings";
import { bootstrap } from "./subcommands/bootstrap.js";
import { chat } from "./subcommands/chat/index.js";
import { clone } from "./subcommands/clone.js";
import { create } from "./subcommands/create.js";
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
import { printVersion, version } from "./subcommands/version.js";
import { UserInputError } from "./types/UserInputError.js";

if (process.argv.length === 2) {
  printVersion();
  console.info();
  console.info("Usage");
}

const HELP_MESSAGE_WIDTH = 100;
const HELP_MESSAGE_PADDING_LEFT = 4;

const helpConfig = {
  helpWidth: HELP_MESSAGE_WIDTH,
  subcommandTerm: (cmd: { name(): string }) =>
    `${cmd.name()}`.padStart(HELP_MESSAGE_PADDING_LEFT + cmd.name().length, " "),
  subcommandDescription: (cmd: { description(): string }) => cmd.description(),
  optionTerm: (option: { flags: string }) =>
    `${option.flags}`.padStart(HELP_MESSAGE_PADDING_LEFT + option.flags.length, " "),
  optionDescription: (option: { description?: string }) => option.description ?? "",
  argumentTerm: (arg: { name(): string }) =>
    `${arg.name()}`.padStart(HELP_MESSAGE_PADDING_LEFT + arg.name().length, " "),
  argumentDescription: (arg: { description?: string }) => arg.description ?? "",
};

program.name("lms").description("LM Studio CLI");
program.configureHelp(helpConfig);

program.commandsGroup("Manage Models:");
program.addCommand(get);
program.addCommand(importCmd);
program.addCommand(ls);

program.commandsGroup("Use Models:");
program.addCommand(chat);
program.addCommand(load);
program.addCommand(ps);
program.addCommand(server);
program.addCommand(unload);

program.commandsGroup("Develop & Publish Artifacts:");
program.addCommand(clone);
program.addCommand(create);
program.addCommand(dev);
program.addCommand(login);
program.addCommand(push);

program.commandsGroup("System Management:");
program.addCommand(bootstrap);
program.addCommand(flags);
program.addCommand(log);
program.addCommand(runtime);
program.addCommand(status);
program.addCommand(version);

program.commands.forEach(cmd => {
  cmd.configureHelp(helpConfig);
});

program.parseAsync(process.argv).catch((error: any) => {
  if (error instanceof UserInputError) {
    // Omit stack trace for UserInputErrors
    console.error(error.message);
  } else {
    console.error(error?.stack ?? error);
  }
  process.exit(1);
});
