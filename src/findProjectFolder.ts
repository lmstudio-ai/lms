import { type SimpleLogger } from "@lmstudio/lms-common";
import { access } from "fs/promises";
import { dirname, join, resolve } from "path";

/**
 * From the given folder, recursively travels back up, until finds one folder that contains a file
 * with the given name.
 */
export async function recursiveFindAncestorFolderWithFile(
  logger: SimpleLogger,
  fileName: string,
  cwd: string,
) {
  let currentDir = resolve(cwd);

  let maximumDepth = 20;
  while (maximumDepth > 0) {
    maximumDepth--;
    const manifestPath = join(currentDir, fileName);
    logger.debug("Trying to access", manifestPath);
    try {
      await access(manifestPath);
      logger.debug(`Found ${fileName} at`, currentDir);
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
  logger.debug(`Reached maximum depth without finding ${fileName}`);
  return null;
}

/**
 * Try to find the ancestor folder with a manifest.json file. If it does not exist, print an error
 * message and exit the process.
 */
export async function findProjectFolderOrExit(logger: SimpleLogger, cwd: string) {
  const projectFolder = await recursiveFindAncestorFolderWithFile(logger, "manifest.json", cwd);
  if (projectFolder === null) {
    logger.errorText`Could not find the project folder. Please invoke this command in a folder with a
      manifest.json file.
      \n       To create an empty plugin, use the \`lms create\` command, or create a new plugin in
      LM Studio.
    `;
    process.exit(1);
  }
  return projectFolder;
}
