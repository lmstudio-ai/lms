import { type SimpleLogger } from "@lmstudio/lms-common";
import { UtilBinary } from "@lmstudio/lms-es-plugin-runner";
import { type LMStudioClient, type PluginManifest, type PluginRunnerType } from "@lmstudio/sdk";
import { join } from "path";
import { PluginProcess, type PluginProcessOpts } from "./PluginProcess.js";

export class NodePluginProcess extends PluginProcess {
  protected override binary = new UtilBinary("node");
  protected override runnerType: PluginRunnerType = "node";
  protected override getArgs(_pluginManifest: PluginManifest): Array<string> {
    return ["--enable-source-maps", join(".lmstudio", "dev.js")];
  }

  public constructor(
    projectPath: string,
    client: LMStudioClient,
    logger: SimpleLogger,
    opts: PluginProcessOpts = {},
  ) {
    super(projectPath, client, join(projectPath, "manifest.json"), logger, opts);
  }
}
