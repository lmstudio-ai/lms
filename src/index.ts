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

if (process.argv.length === 2) {
  printVersion();
  console.info();
  console.info("Usage");
}

program.name("lms").description("LM Studio CLI");

program.addCommand(chat);
program.addCommand(status);
program.addCommand(server);
program.addCommand(ls);
program.addCommand(ps);
program.addCommand(get);
program.addCommand(load);
program.addCommand(unload);
program.addCommand(create);
program.addCommand(log);
program.addCommand(dev);
program.addCommand(push);
program.addCommand(clone);
program.addCommand(login);
program.addCommand(importCmd);
program.addCommand(flags);
program.addCommand(bootstrap);
program.addCommand(version);

program.parseAsync(process.argv).catch((error: any) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
