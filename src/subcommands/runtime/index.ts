import { Command } from "@commander-js/extra-typings";
import { get } from "./get.js";
import { ls } from "./list.js";
import { remove } from "./remove.js";
import { select } from "./select.js";
import { survey } from "./survey.js";
import { update } from "./update.js";

// Create the runtime command
const runtimeCommand = new Command()
  .name("runtime")
  .description("Manage and update the inference runtime");

// Add subcommands
runtimeCommand.addCommand(ls);
runtimeCommand.addCommand(select);
runtimeCommand.addCommand(remove);
runtimeCommand.addCommand(update);
runtimeCommand.addCommand(get);
runtimeCommand.addCommand(survey);

export const runtime = runtimeCommand;
