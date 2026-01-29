import { Command } from "@commander-js/extra-typings";
import { inspect } from "./inspect.js";
import { list } from "./list.js";
import { validate } from "./validate.js";

const skillsCommand = new Command()
  .name("skills")
  .description("Discover, validate, and inspect Agent Skills");

skillsCommand.addCommand(list);
skillsCommand.addCommand(validate);
skillsCommand.addCommand(inspect);

export const skills = skillsCommand;
