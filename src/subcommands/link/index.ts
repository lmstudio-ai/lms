import { Command } from "@commander-js/extra-typings";
import { deSetup } from "./deSetup.js";
import { disable } from "./disable.js";
import { enable } from "./enable.js";
import { setDeviceName } from "./setDeviceName.js";
import { setPreferredDevice } from "./setPreferredDevice.js";
import { setup } from "./setup.js";
import { status } from "./status.js";

export const link = new Command()
  .name("link")
  .description("Commands for managing LM Link")
  .addCommand(enable)
  .addCommand(disable)
  .addCommand(status)
  .addCommand(setDeviceName)
  .addCommand(setPreferredDevice)
  .addCommand(setup, { hidden: true })
  .addCommand(deSetup, { hidden: true });
