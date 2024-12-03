import { homedir } from "os";
import { join } from "path";

export const pluginsFolderPath = join(homedir(), ".cache", "lm-studio", "extensions", "plugins");
export const lmsKey2Path = join(homedir(), ".cache", "lm-studio", ".internal", "lms-key-2");
