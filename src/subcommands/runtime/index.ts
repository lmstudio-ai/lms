import { Command } from "@commander-js/extra-typings";
import { get } from "./get.js";
import { ls } from "./list.js";
import { remove } from "./remove.js";
import { select } from "./select.js";

// Create the runtime command
const runtimeCommand = new Command().name("runtime").description("Manage runtime engines");

// Add subcommands
runtimeCommand.addCommand(ls);
runtimeCommand.addCommand(select);
runtimeCommand.addCommand(remove);
runtimeCommand.addCommand(get);

export const runtime = runtimeCommand;
