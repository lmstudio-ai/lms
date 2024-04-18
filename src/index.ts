import { run, subcommands } from "cmd-ts";
import { ls, ps } from "./subcommands/list";
import { server } from "./subcommands/server";
import { status } from "./subcommands/status";
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
    version,
  },
});

run(cli, process.argv.slice(2));
