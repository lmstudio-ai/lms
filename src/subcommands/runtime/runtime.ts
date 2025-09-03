import { Command } from "@commander-js/extra-typings";
import { ls } from "./list.js";

export const runtime = new Command()
  .name("runtime")
  .description("Find and manage runtimes")
  .addCommand(ls);
