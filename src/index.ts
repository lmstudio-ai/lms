import { run, subcommands } from "cmd-ts";
import { bootstrap } from "./subcommands/bootstrap";
import { create } from "./subcommands/create";
import { dev } from "./subcommands/dev";
import { get } from "./subcommands/get";
import { importCmd } from "./subcommands/importCmd";
import { ls, ps } from "./subcommands/list";
import { load } from "./subcommands/load";
import { log } from "./subcommands/log";
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
    get,
    load,
    unload,
    create,
    log,
    dev,
    import: importCmd,
    version,
    bootstrap,
  },
});

run(cli, process.argv.slice(2)).catch(error => {
  console.error(error?.message ?? error);
  process.exit(1);
});
