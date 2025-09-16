import { program } from "@commander-js/extra-typings";
import { bootstrap } from "./subcommands/bootstrap.js";
import { chat } from "./subcommands/chat/index.js";
import { clone } from "./subcommands/clone.js";
import { create } from "./subcommands/create.js";
import { dev } from "./subcommands/dev.js";
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

program.name("lms").description("LM Studio CLI");

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

program.parseAsync(process.argv).catch((error: any) => {
  if (error instanceof UserInputError) {
    // Omit stack trace for UserInputErrors
    console.error(error.message);
  } else {
    console.error(error?.stack ?? error);
  }
  process.exit(1);
});
