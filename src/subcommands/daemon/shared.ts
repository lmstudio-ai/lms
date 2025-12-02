import { type SimpleLogger } from "@lmstudio/lms-common";
import { existsSync, readFileSync } from "fs";
import { dirname } from "path";
import { llmsterInstallLocationFilePath } from "../../lmstudioPaths.js";

export interface InstallLocationFileContent {
  path?: string;
  argv?: Array<string>;
  cwd?: string;
}

export interface InstallLocationData {
  executablePath: string;
  workingDirectory: string;
  argv: Array<string>;
}

export function readInstallLocationOrExit(logger: SimpleLogger): InstallLocationData {
  const installLocationPath = llmsterInstallLocationFilePath;
  const installLocationDescription = "llmster-install-location.json";

  if (existsSync(installLocationPath) === false) {
    logger.error(`Cannot find install location file at ${installLocationPath}.`);
    process.exit(1);
  }

  let parsedInstallLocation: InstallLocationFileContent | undefined;
  try {
    const rawInstallLocation = readFileSync(installLocationPath, "utf-8");
    const parsedInstallLocationUnknown: unknown = JSON.parse(rawInstallLocation);
    if (typeof parsedInstallLocationUnknown === "object" && parsedInstallLocationUnknown !== null) {
      parsedInstallLocation = parsedInstallLocationUnknown as InstallLocationFileContent;
    }
  } catch (error) {
    logger.error(
      `Failed to read or parse install location from ${installLocationDescription} at ${installLocationPath}:`,
      error as Error,
    );
    process.exit(1);
  }

  if (
    parsedInstallLocation === undefined ||
    typeof parsedInstallLocation.path !== "string" ||
    parsedInstallLocation.path.length === 0
  ) {
    logger.error(
      `Install location file ${installLocationDescription} at ${installLocationPath} does not contain a valid executable path.`,
    );
    process.exit(1);
  }

  const executablePath = parsedInstallLocation.path;
  const hasCustomCwd =
    parsedInstallLocation.cwd !== undefined &&
    typeof parsedInstallLocation.cwd === "string" &&
    parsedInstallLocation.cwd.length > 0;
  let workingDirectory: string = dirname(executablePath);
  if (hasCustomCwd === true) {
    workingDirectory = parsedInstallLocation.cwd as string;
  }

  const parsedArgv = Array.isArray(parsedInstallLocation.argv) ? parsedInstallLocation.argv : [];
  const normalizedArgv = parsedArgv.filter(argument => typeof argument === "string");

  return {
    executablePath,
    workingDirectory,
    argv: normalizedArgv,
  };
}
