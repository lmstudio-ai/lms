import { SimpleLogger } from "@lmstudio/lms-common";
import { type UtilBinary } from "@lmstudio/lms-es-plugin-runner";
import { pluginManifestSchema } from "@lmstudio/lms-shared-types";
import { type LMStudioClient, type PluginManifest, type PluginRunnerType } from "@lmstudio/sdk";
import { type ChildProcessWithoutNullStreams } from "child_process";
import { readFile } from "fs/promises";

type PluginProcessStatus = "stopped" | "starting" | "running" | "restarting";
export interface PluginProcessOpts {
  noNotify?: boolean;
}

export abstract class PluginProcess {
  protected abstract binary: UtilBinary;
  protected abstract runnerType: PluginRunnerType;
  protected abstract getArgs(pluginManifest: PluginManifest): Array<string>;
  private readonly serverLogger: SimpleLogger;
  private readonly stderrLogger: SimpleLogger;
  protected constructor(
    private readonly cwd: string,
    private readonly client: LMStudioClient,
    private readonly manifestFilePath: string,
    private readonly logger: SimpleLogger,
    private readonly opts: PluginProcessOpts = {},
  ) {
    this.serverLogger = new SimpleLogger("plugin-server", this.logger);
    this.stderrLogger = new SimpleLogger("stderr", this.logger);
  }

  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private status: PluginProcessStatus = "stopped";
  private unregister: (() => Promise<void>) | null = null;
  private firstTime = true;

  private async startProcess() {
    this.status = "starting";
    let manifest: PluginManifest;

    try {
      const manifestContent = await readFile(this.manifestFilePath, "utf-8");
      manifest = pluginManifestSchema.parse(JSON.parse(manifestContent));
    } catch (error) {
      this.serverLogger.error(`Failed to read or parse manifest file.`, error);
      this.status = "stopped";
      return;
    }

    if (manifest.runner !== this.runnerType) {
      this.serverLogger.errorText`
        "lms dev" currently does not support changing the runner type dynamically. Please re-run
        "lms dev".
      `;
      this.status = "stopped";
      return;
    }

    const { unregister, clientIdentifier, clientPasskey, baseUrl, denoBrokerIpcPath } =
      await this.client.plugins.registerDevelopmentPlugin({ manifest });
    if (this.firstTime) {
      const identifier = `${manifest.owner}/${manifest.name}`;
      if (this.opts.noNotify !== true) {
        await this.client.system.notify({
          title: `Plugin "${identifier}" started`,
          description: "This plugin is run by lms CLI development server.",
        });
      }
      this.firstTime = false;
    }
    this.unregister = unregister;
    let env: Record<string, string | undefined> = {
      FORCE_COLOR: "1",
      LMS_PLUGIN_CLIENT_IDENTIFIER: clientIdentifier,
      LMS_PLUGIN_CLIENT_PASSKEY: clientPasskey,
      LMS_PLUGIN_BASE_URL: baseUrl,
    };
    if (denoBrokerIpcPath !== undefined) {
      env = {
        ...env,
        DENO_PERMISSION_BROKER_PATH: denoBrokerIpcPath,
      };
    }
    this.currentProcess = this.binary.spawn(this.getArgs(manifest), {
      env,
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
