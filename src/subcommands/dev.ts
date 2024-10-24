import { SimpleLogger, Validator } from "@lmstudio/lms-common";
import { Esbuild, EsPluginRunnerWatcher } from "@lmstudio/lms-es-plugin-runner";
import { pluginManifestSchema } from "@lmstudio/lms-shared-types/dist/PluginManifest";
import { type ChildProcessWithoutNullStreams, spawn } from "child_process";
import { command } from "cmd-ts";
import { access, readFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { cwd } from "process";
import { createLogger, logLevelArgs } from "../logLevel";

/**
 * From the given folder, recursively travels back up, until finds one folder with manifest.json.
 */
async function findProjectFolder(logger: SimpleLogger, cwd: string) {
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

type PluginProcessStatus = "stopped" | "running" | "restarting";

class PluginProcess {
  public constructor(
    private readonly executable: string,
    private readonly args: Array<string>,
    private readonly env: Record<string, string>,
    private readonly logger: SimpleLogger,
  ) {}
  private stdoutLogger = new SimpleLogger("stdout", this.logger);
  private stderrLogger = new SimpleLogger("stderr", this.logger);
  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private status: PluginProcessStatus = "stopped";

  private startProcess() {
    this.currentProcess = spawn(this.executable, this.args, {
      env: {
        FORCE_COLOR: "1",
        ...this.env,
      },
    });
    this.currentProcess.on("exit", (code, signal) => {
      if (code !== null) {
        this.logger.warn(`Plugin process exited with code ${code}`);
      } else {
        if (signal === "SIGKILL") {
          // OK to ignore because we killed it
        } else {
          this.logger.warn(`Plugin process exited with signal ${signal}`);
        }
      }
      if (this.status === "restarting") {
        this.startProcess();
      } else {
        this.status = "stopped";
      }
    });
    this.currentProcess.stdout.on("data", data => {
      this.stdoutLogger.info(data.toString("utf-8").trimEnd());
    });
    this.currentProcess.stderr.on("data", data => {
      this.stderrLogger.error(data.toString("utf-8").trimEnd());
    });
    this.status = "running";
  }
  public run() {
    switch (this.status) {
      case "stopped": {
        this.startProcess();
        break;
      }
      case "running": {
        this.status = "restarting";
        this.currentProcess?.kill("SIGKILL");
        this.currentProcess = null;
        break;
      }
      case "restarting": {
        // Already restarting. Do nothing.
        break;
      }
    }
  }
}

export const dev = command({
  name: "dev",
  description: "Starts the development server for the plugin in the current folder.",
  args: {
    ...logLevelArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    const projectPath = await findProjectFolder(logger, cwd());
    if (projectPath === null) {
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
    const manifestPath = join(projectPath, "manifest.json");
    const manifestParseResult = pluginManifestSchema.safeParse(
      JSON.parse(await readFile(manifestPath, "utf-8")),
    );
    if (!manifestParseResult.success) {
      logger.error("Failed to parse the manifest file.");
      logger.error(Validator.prettyPrintZod("manifest", manifestParseResult.error));
      process.exit(1);
    }
    const manifest = manifestParseResult.data;

    logger.info(`Starting the development server for ${manifest.owner}/${manifest.name}...`);

    const pluginServerLogger = new SimpleLogger("plugin-server", logger);

    const watcher = new EsPluginRunnerWatcher(new Esbuild(), cwd(), logger);

    const pluginProcess = new PluginProcess(
      process.platform === "win32" ? "node.exe" : "node",
      ["--enable-source-maps", join(projectPath, ".lmstudio", "dev.js")],
      {
        LMS_CLIENT_IDENTIFIER: `dev-plugin-${manifest.owner}/${manifest.name}`,
        LMS_CLIENT_PASSKEY: `dev-plugin-${manifest.owner}/${manifest.name}`,
      },
      pluginServerLogger,
    );

    watcher.updatedEvent.subscribe(() => {
      pluginProcess.run();
    });
    await watcher.start();
  },
});
