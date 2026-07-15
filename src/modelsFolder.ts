import { type SimpleLogger } from "@lmstudio/lms-common";
import { findLMStudioHome } from "@lmstudio/lms-common-server";
import { access, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { defaultModelsFolder } from "./lmstudioPaths.js";

/**
 * Locate the settings.json file of LM Studio.
 *
 * @param logger - The logger to use.
 * @returns A promise that resolves with the path to the settings.json file, or null if it does not
 * exist.
 */
export async function locateSettingsJson(logger: SimpleLogger) {
  logger.debug("Locating settings.json");
  const lmstudioHome = findLMStudioHome();
  const settingsJsonFilePath = join(lmstudioHome, "settings.json");
  logger.debug("Settings.json file path", settingsJsonFilePath);
  try {
    await access(settingsJsonFilePath);
    return settingsJsonFilePath;
  } catch (error) {
    logger.debug("settings.json does not exist", error);
    return null;
  }
}

/**
 * Resolve the path to the models folder. If the settings.json file exists, use the downloadsFolder
 * field. Otherwise, fall back to the default models folder.
 *
 * @param logger - The logger to use.
 * @param opts - Options. Set `ensureExists` to `false` to skip creating the folder if it does not
 * exist (useful for read-only operations such as listing or removing models).
 * @returns A promise that resolves with the path to the models folder.
 */
export async function resolveModelsFolderPath(
  logger: SimpleLogger,
  { ensureExists = true }: { ensureExists?: boolean } = {},
) {
  const settingsJsonPath = await locateSettingsJson(logger);
  let modelsFolderPath = defaultModelsFolder;
  if (settingsJsonPath === null) {
    logger.warn(
      "Could not locate LM Studio configuration file, using default path:",
      modelsFolderPath,
    );
  } else {
    try {
      const content = await readFile(settingsJsonPath, "utf8");
      const settings = JSON.parse(content);
      modelsFolderPath = settings.downloadsFolder;
      if (typeof modelsFolderPath !== "string") {
        throw new Error("downloadsFolder is not a string");
      }
    } catch (error) {
      logger.warn(
        "Could not parse LM Studio configuration file, using default path:",
        modelsFolderPath,
      );
      logger.debug(error);
    }
  }
  if (ensureExists) {
    await mkdir(modelsFolderPath, { recursive: true });
  }
  return modelsFolderPath;
}
