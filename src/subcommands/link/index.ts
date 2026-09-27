import { Command } from "@commander-js/extra-typings";
import { t } from "../../i18n/index.js";
import { disable } from "./disable.js";
import { enable } from "./enable.js";
import { setDeviceName } from "./setDeviceName.js";
import { setPreferredDevice } from "./setPreferredDevice.js";
import { status } from "./status.js";

export const link = new Command()
  .name("link")
  .description(t("Commands for managing LM Link"))
  .addCommand(enable)
  .addCommand(disable)
  .addCommand(status)
  .addCommand(setDeviceName)
  .addCommand(setPreferredDevice);
