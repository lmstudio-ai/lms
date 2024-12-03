import { run, subcommands } from "cmd-ts";
import { bootstrap } from "./subcommands/bootstrap.js";
import { create } from "./subcommands/create.js";
import { dev } from "./subcommands/dev.js";
import { get } from "./subcommands/get.js";
import { importCmd } from "./subcommands/importCmd.js";
import { ls, ps } from "./subcommands/list.js";
import { load } from "./subcommands/load.js";
import { log } from "./subcommands/log.js";
import { pull } from "./subcommands/pull.js";
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
    ...(process.env.LMS_DEV
      ? {
          dev,
          push,
          pull,
        }
      : {}),
    import: importCmd,
    bootstrap,
    version,
  },
});

run(cli, process.argv.slice(2)).catch(error => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
