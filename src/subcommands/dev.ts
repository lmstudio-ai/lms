import { SimpleLogger, text, Validator } from "@lmstudio/lms-common";
import { EsPluginRunnerWatcher, UtilBinary } from "@lmstudio/lms-es-plugin-runner";
import { pluginManifestSchema } from "@lmstudio/lms-shared-types";
import {
  type LMStudioClient,
  type PluginManifest,
  type RegisterDevelopmentPluginOpts,
} from "@lmstudio/sdk";
import { type ChildProcessWithoutNullStreams } from "child_process";
import { boolean, command, flag } from "cmd-ts";
import { cp, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { cwd } from "process";
import { askQuestion } from "../confirm.js";
import { createClient, createClientArgs } from "../createClient.js";
import { exists } from "../exists.js";
import { findProjectFolderOrExit } from "../findProjectFolder.js";
import { pluginsFolderPath } from "../lmstudioPaths.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

type PluginProcessStatus = "stopped" | "starting" | "running" | "restarting";

class PluginProcess {
  public constructor(
    private readonly client: LMStudioClient,
    private readonly registerDevelopmentPluginOpts: RegisterDevelopmentPluginOpts,
    private readonly cwd: string,
    private readonly logger: SimpleLogger,
  ) {}
  private readonly node = new UtilBinary("node");
  private readonly args = ["--enable-source-maps", join(".lmstudio", "dev.js")];
  private readonly serverLogger = new SimpleLogger("plugin-server", this.logger);
  private readonly stderrLogger = new SimpleLogger("stderr", this.logger);

  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private status: PluginProcessStatus = "stopped";
  private unregister: (() => Promise<void>) | null = null;
  private firstTime = true;

  private async startProcess() {
    this.status = "starting";
    const { unregister, clientIdentifier, clientPasskey } =
      await this.client.plugins.registerDevelopmentPlugin(this.registerDevelopmentPluginOpts);
    if (this.firstTime) {
      const manifest = this.registerDevelopmentPluginOpts.manifest;
      const identifier = `${manifest.owner}/${manifest.name}`;
      await this.client.system.notify({
        title: `Plugin "${identifier}" started`,
        description: "This plugin is run by lms CLI development server.",
      });
      this.firstTime = false;
    }
    this.unregister = unregister;
    this.currentProcess = this.node.spawn(this.args, {
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
    install: flag({
      type: boolean,
      long: "install",
      short: "i",
      description: text`
        When specified, instead of starting the development server, installs the plugin to
        LM Studio.
      `,
    }),
    yes: flag({
      type: boolean,
      long: "yes",
      short: "y",
      description: text`
        Suppress all confirmations and warnings. Useful for scripting.

        - When used with --install, it will overwrite the plugin without asking.
      `,
    }),
    ...logLevelArgs,
    ...createClientArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    const projectPath = await findProjectFolderOrExit(logger, cwd());
    const { install, yes } = args;
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

    if (install) {
      process.exit(await handleInstall(projectPath, manifest, logger, client, { yes }));
    } else {
      await handleDevServer(projectPath, manifest, logger, client);
    }
  },
});

async function handleInstall(
  projectPath: string,
  manifest: PluginManifest,
  logger: SimpleLogger,
  client: LMStudioClient,
  { yes }: { yes: boolean },
): Promise<number> {
  // Currently, we naively copy paste the entire plugin folder to LM Studio, and then trigger a
  // plugin re-index.
  logger.info(`Installing the plugin ${manifest.owner}/${manifest.name}...`);
  logger.debug("Copying from", projectPath);
  const destinationPath = join(pluginsFolderPath, manifest.owner, manifest.name);
  logger.debug("To", pluginsFolderPath);

  if ((await exists(destinationPath)) && !yes) {
    const result = await askQuestion(text`
      Plugin ${manifest.owner}/${manifest.name} already exists. Do you want to overwrite it?
    `);
    if (!result) {
      logger.info("Installation cancelled.");
      return 1;
    }
  }

  await mkdir(destinationPath, { recursive: true });
  const startTime = Date.now();
  await cp(projectPath, destinationPath, {
    recursive: true,
    dereference: true,
  });
  const endTime = Date.now();
  logger.debug(`Copied in ${endTime - startTime}ms.`);

  logger.debug("Reindexing plugins...");
  await client.plugins.reindexPlugins();

  return 0;
}

async function handleDevServer(
  projectPath: string,
  manifest: PluginManifest,
  logger: SimpleLogger,
  client: LMStudioClient,
) {
  logger.info(`Starting the development server for ${manifest.owner}/${manifest.name}...`);

  const esbuild = new UtilBinary("esbuild");
  const watcher = new EsPluginRunnerWatcher(esbuild, cwd(), logger);

  const pluginProcess = new PluginProcess(client, { manifest }, projectPath, logger);

  watcher.updatedEvent.subscribe(() => {
    pluginProcess.run();
  });
  await watcher.start();

  client.system.whenDisconnected().then(() => {
    logger.info("Disconnected from the server. Stopping the development server.");
    process.exit(1);
  });
}
