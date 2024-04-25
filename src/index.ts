import { run, subcommands } from "cmd-ts";
import { bootstrap } from "./subcommands/bootstrap";
import { create } from "./subcommands/create";
import { ls, ps } from "./subcommands/list";
import { load } from "./subcommands/load";
import { server } from "./subcommands/server";
import { status } from "./subcommands/status";
import { unload } from "./subcommands/unload";
import { printVersion, version } from "./subcommands/version";

if (process.argv.length === 2) {
  printVersion();
  console.info();
  console.info("Usage");
}

const cli = subcommands({
  name: "lms",
  cmds: {
    status,
    server,
    ls,
    ps,
    load,
    unload,
    create,
    version,
    bootstrap,
  },
});

run(cli, process.argv.slice(2)).catch(error => {
  console.error(error?.message ?? error);
  process.exit(1);
});
