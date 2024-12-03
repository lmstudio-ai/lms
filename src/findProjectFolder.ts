import { type SimpleLogger } from "@lmstudio/lms-common";
import { access } from "fs/promises";
import { dirname, join, resolve } from "path";

/**
 * From the given folder, recursively travels back up, until finds one folder with manifest.json.
 */
export async function findProjectFolder(logger: SimpleLogger, cwd: string) {
  let currentDir = resolve(cwd);

  let maximumDepth = 20;
  while (maximumDepth > 0) {
    maximumDepth--;
    const manifestPath = join(currentDir, "manifest.json");
    logger.debug("Trying to access", manifestPath);
    try {
      await access(manifestPath);
      logger.debug("Found manifest.json at", currentDir);
      return currentDir;
    } catch (err) {
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) {
        // Reached the root directory without finding manifest.json
        return null;
      }
      currentDir = parentDir;
    }
  }
  logger.debug("Reached maximum depth without finding manifest.json");
  return null;
}

export async function findProjectFolderOrExit(logger: SimpleLogger, cwd: string) {
  const projectFolder = await findProjectFolder(logger, cwd);
  if (projectFolder === null) {
    logger.errorText`
      Could not find the project folder. Please invoke this command in a folder with a
      manifest.json file.
    `;
    logger.errorText`
      To create an empty plugin, use the \`lms create\` command, or create a new plugin in
      LM Studio.
    `;
    process.exit(1);
  }
  return projectFolder;
}
