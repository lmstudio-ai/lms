import { SimpleLogger } from "@lmstudio/lms-common";
import { type UtilBinary } from "@lmstudio/lms-es-plugin-runner";
import { type LMStudioClient, type RegisterDevelopmentPluginOpts } from "@lmstudio/sdk";
import { type ChildProcessWithoutNullStreams } from "child_process";

type PluginProcessStatus = "stopped" | "starting" | "running" | "restarting";
interface PluginProcessOpts {
  noNotify?: boolean;
}

export class PluginProcess {
  public constructor(
    private readonly binary: UtilBinary,
    private readonly args: Array<string>,
    private readonly cwd: string,
    private readonly client: LMStudioClient,
    private readonly registerDevelopmentPluginOpts: RegisterDevelopmentPluginOpts,
    private readonly logger: SimpleLogger,
    private readonly opts: PluginProcessOpts = {},
  ) {}
  private readonly serverLogger = new SimpleLogger("plugin-server", this.logger);
  private readonly stderrLogger = new SimpleLogger("stderr", this.logger);

  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private status: PluginProcessStatus = "stopped";
  private unregister: (() => Promise<void>) | null = null;
  private firstTime = true;

  private async startProcess() {
    this.status = "starting";
    const { unregister, clientIdentifier, clientPasskey, baseUrl, denoBrokerIpcPath } =
      await this.client.plugins.registerDevelopmentPlugin(this.registerDevelopmentPluginOpts);
    if (this.firstTime) {
      const manifest = this.registerDevelopmentPluginOpts.manifest;
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
    let env: Record<string, string> = {
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
    this.currentProcess = this.binary.spawn(this.args, {
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
