import { Command } from "@commander-js/extra-typings";
import { info, status } from "./status.js";
import { up } from "./up.js";
import { updateDaemon } from "./update.js";

const daemon = new Command()
  .name("daemon")
  .description("Commands for managing the LM Studio daemon")
  .addCommand(up)
  .addCommand(status)
  .addCommand(info)
  .addCommand(updateDaemon);

export { daemon };
