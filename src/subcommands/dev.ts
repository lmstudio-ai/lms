import { SimpleLogger, Validator } from "@lmstudio/lms-common";
import { Esbuild, EsPluginRunnerWatcher } from "@lmstudio/lms-es-plugin-runner";
import { pluginManifestSchema } from "@lmstudio/lms-shared-types/dist/PluginManifest";
import { type LMStudioClient, type RegisterDevelopmentPluginOpts } from "@lmstudio/sdk";
import { type ChildProcessWithoutNullStreams, spawn } from "child_process";
import { command } from "cmd-ts";
import { access, readFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { cwd } from "process";
import { createClient, createClientArgs } from "../createClient";
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

type PluginProcessStatus = "stopped" | "starting" | "running" | "restarting";

class PluginProcess {
  public constructor(
    private readonly client: LMStudioClient,
    private readonly registerDevelopmentPluginOpts: RegisterDevelopmentPluginOpts,
    private readonly cwd: string,
    private readonly logger: SimpleLogger,
  ) {}
  private readonly executable = process.platform === "win32" ? "node.exe" : "node";
  private readonly args = ["--enable-source-maps", join(".lmstudio", "dev.js")];
  private readonly serverLogger = new SimpleLogger("plugin-server", this.logger);
  private readonly stderrLogger = new SimpleLogger("stderr", this.logger);

  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private status: PluginProcessStatus = "stopped";
  private unregister: (() => Promise<void>) | null = null;

  private async startProcess() {
    this.status = "starting";
    const { unregister, clientIdentifier, clientPasskey } =
      await this.client.plugins.registerDevelopmentPlugin(this.registerDevelopmentPluginOpts);
    this.unregister = unregister;
    this.currentProcess = spawn(this.executable, this.args, {
      env: {
        FORCE_COLOR: "1",
        ...process.env,
        LMS_PLUGIN_CLIENT_IDENTIFIER: clientIdentifier,
        LMS_PLUGIN_CLIENT_PASSKEY: clientPasskey,
      },
      cwd: this.cwd,
    });
    this.currentProcess.stdout.on("data", data => this.logger.info(data.toString("utf-8").trim()));
    this.currentProcess.stderr.on("data", data =>
      this.stderrLogger.error(data.toString("utf-8").trim()),
    );
    this.currentProcess.on("exit", async (code, signal) => {
      await this.unregister?.();
      this.unregister = null;
      if (code !== null) {
        this.serverLogger.warn(`Plugin process exited with code ${code}`);
      } else {
        if (signal === "SIGKILL") {
          // OK to ignore because we killed it
        } else {
          this.serverLogger.warn(`Plugin process exited with signal ${signal}`);
        }
      }
      if (this.status === "restarting") {
        this.startProcess();
      } else {
        this.status = "stopped";
      }
    });
    this.status = "running";
  }
  public run() {
    switch (this.status) {
      case "stopped": {
        this.startProcess();
        break;
      }
      case "starting": {
        // Already starting. Do nothing.
        break;
      }
      case "running": {
        this.status = "restarting";
        if (this.unregister === null) {
          this.currentProcess?.kill("SIGKILL");
          this.currentProcess = null;
        } else {
          this.unregister().then(() => {
            this.unregister = null;
            this.currentProcess?.kill("SIGKILL");
            this.currentProcess = null;
          });
        }
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
    ...createClientArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
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

    const watcher = new EsPluginRunnerWatcher(new Esbuild(), cwd(), logger);

    const pluginProcess = new PluginProcess(client, { manifest }, projectPath, logger);

    watcher.updatedEvent.subscribe(() => {
      pluginProcess.run();
    });
    await watcher.start();
  },
});
