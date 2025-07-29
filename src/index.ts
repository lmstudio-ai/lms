import { program } from "@commander-js/extra-typings";
import { bootstrap } from "./subcommands/bootstrap.js";
import { chat } from "./subcommands/chat.js";
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
import { server } from "./subcommands/server.js";
import { status } from "./subcommands/status.js";
import { unload } from "./subcommands/unload.js";
import { printVersion, version } from "./subcommands/version.js";
import { env } from "./subcommands/env.js";

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
progrma.addCommand(env);
program.addCommand(flags);
program.addCommand(log);
program.addCommand(status);
program.addCommand(version);

program.parseAsync(process.argv).catch((error: any) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
