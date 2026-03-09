import { type SimpleLogger } from "@lmstudio/lms-common";
import { UtilBinary } from "@lmstudio/lms-es-plugin-runner";
import { type LMStudioClient, type PluginManifest, type PluginRunnerType } from "@lmstudio/sdk";
import { join } from "path";
import { PluginProcess, type PluginProcessOpts } from "./PluginProcess.js";

export class DenoPluginProcess extends PluginProcess {
  protected override binary = new UtilBinary("deno");
  protected override runnerType: PluginRunnerType = "deno";
  protected override getArgs(pluginManifest: PluginManifest): Array<string> {
    const args = ["run", "--quiet"];
    if (pluginManifest.sandbox === undefined || !pluginManifest.sandbox.enabled) {
      args.push("--allow-all");
    } else {
      // If sandboxing is enabled, we don't pass in the --allow-all. Inside the PluginProcess, it
      // will receive the broker path from LM Studio and pass it to deno via an environment
      // variable.
    }
    args.push(this.entryFilePath);
    return args;
  }

  public constructor(
    projectPath: string,
    client: LMStudioClient,
    private readonly entryFilePath: string,
    logger: SimpleLogger,
    opts: PluginProcessOpts = {},
  ) {
    super(projectPath, client, join(projectPath, "manifest.json"), logger, opts);
  }
}
