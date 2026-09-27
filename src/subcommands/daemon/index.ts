import { Command } from "@commander-js/extra-typings";
import { t } from "../../i18n/index.js";
import { down } from "./down.js";
import { status } from "./status.js";
import { up } from "./up.js";
import { updateDaemon } from "./update.js";

const daemon = new Command()
  .name("daemon")
  .description(t("Commands for managing the LM Studio daemon"))
  .addCommand(up)
  .addCommand(down)
  .addCommand(status)
  .addCommand(updateDaemon);

export { daemon };
