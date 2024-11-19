import { homedir } from "os";
import { join } from "path";

export const pluginsFolderPath = join(homedir(), ".cache", "lm-studio", "extensions", "plugins");
