import { Command } from "@commander-js/extra-typings";
import { ls } from "./list.js";

// Create the runtime command
const runtimeCommand = new Command().name("runtime").description("Manage runtime engines");

// Add subcommands
runtimeCommand.addCommand(ls);

export const runtime = runtimeCommand;
