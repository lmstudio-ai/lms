import { Command, type OptionValues } from "@commander-js/extra-typings";
import { type SimpleLogger, text, Validator } from "@lmstudio/lms-common";
import { DenoPluginRunnerWatcher } from "@lmstudio/lms-es-plugin-runner/deno-runner-watcher";
import { NodePluginRunnerWatcher } from "@lmstudio/lms-es-plugin-runner/node-runner-watcher";
import { UtilBinary } from "@lmstudio/lms-es-plugin-runner/util-binary";
import { pluginManifestSchema } from "@lmstudio/lms-shared-types";
import { type LMStudioClient, type PluginManifest } from "@lmstudio/sdk";
import { readFile } from "fs/promises";
import { join } from "path";
import { cwd } from "process";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../../createClient.js";
import { exists } from "../../exists.js";
import { findProjectFolderOrExit } from "../../findProjectFolder.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { DenoPluginProcess } from "./DenoPluginProcess.js";
import { NodePluginProcess } from "./NodePluginProcess.js";

type DevCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    install?: boolean;
    yes?: boolean;
    notify?: boolean;
  };

const devCommand = new Command<[], DevCommandOptions>()
  .name("dev")
  .description("Starts a plugin dev server in the current folder")
  .option(
    "-i, --install",
    text`
      When specified, instead of starting the development server, installs the plugin to
      LM Studio.
    `,
  )
  .option(
    "-y, --yes",
    text`
      Automatically approve all prompts. Useful for scripting.
      When used with --install, it will overwrite the plugin without asking.
    `,
  )
  .option(
    "--no-notify",
    text`
      When specified, will not produce the "Plugin started" notification in LM Studio.
    `,
  );

addCreateClientOptions(devCommand);
addLogLevelOptions(devCommand);

devCommand.action(async (options: DevCommandOptions) => {
  const { install = false, notify } = options;
  const logger = createLogger(options);
  // We don't want to dispose the client immediately, instead of using 'using'
  // we'll dispose it when the client disconnects from the server.
  const client = await createClient(logger, options);
  const projectPath = await findProjectFolderOrExit(logger, cwd());
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
    process.exit(await handleInstall(projectPath, manifest, logger, client));
  } else {
    const noNotify = notify === false;
    await handleDevServer(projectPath, manifest, logger, client, { noNotify });
  }
});

async function handleInstall(
  projectPath: string,
  manifest: PluginManifest,
  logger: SimpleLogger,
  client: LMStudioClient,
): Promise<number> {
  logger.info(`Installing the plugin ${manifest.owner}/${manifest.name}...`);
  await client.repository.installLocalPlugin({ path: projectPath });
  logger.info(`Successfully installed ${manifest.owner}/${manifest.name}.`);
  return 0;
}

async function ensureNpmDependencies(path: string, logger: SimpleLogger, client: LMStudioClient) {
  const packageJson = join(path, "package.json");
  if (!(await exists(packageJson))) {
    logger.error("No package.json found in the plugin folder.");
    process.exit(1);
  }
  if (!(await exists(join(path, "node_modules")))) {
    logger.info("Installing npm dependencies...");
    await client.repository.installPluginDependencies(path);
  } else {
    logger.debug("node_modules already exists. Skipping npm install.");
  }
}

async function handleDevServer(
  projectPath: string,
  manifest: PluginManifest,
  logger: SimpleLogger,
  client: LMStudioClient,
  { noNotify }: { noNotify: boolean },
) {
  if (manifest.type !== "plugin") {
    logger.error("The version of lms you are using only supports plugins.");
    process.exit(1);
  }

  const runner = manifest.runner;

  switch (runner) {
    case "ecmascript":
    case "node":
      await ensureNpmDependencies(projectPath, logger, client);
      logger.info(`Starting the development server for ${manifest.owner}/${manifest.name}...`);
      await startNodeDevServer(projectPath, logger, client, { noNotify });
      break;
    case "deno": {
      await ensureNpmDependencies(projectPath, logger, client);
      logger.info(`Starting the development server for ${manifest.owner}/${manifest.name}...`);
      await startDenoDevServer(projectPath, manifest, logger, client, { noNotify });
      break;
    }
    default: {
      logger.error("The version of lms you are using only supports node/deno plugins.");
      process.exit(1);
    }
  }
  client.system
    .whenDisconnected()
    .then(async () => {
      await client[Symbol.asyncDispose]();
      logger.info("Disconnected from the server. Stopping the development server.");
      process.exit(1);
    })
    .catch(() => {
      console.error("Error while disposing the client.");
      process.exit(1);
    });
}

async function startNodeDevServer(
  projectPath: string,
  logger: SimpleLogger,
  client: LMStudioClient,
  { noNotify }: { noNotify: boolean },
) {
  const esbuild = new UtilBinary("esbuild");
  const watcher = new NodePluginRunnerWatcher(esbuild, cwd(), logger);
  const pluginProcess = new NodePluginProcess(projectPath, client, logger, { noNotify });

  watcher.updatedEvent.subscribe(() => {
    pluginProcess.run();
  });
  await watcher.start();
}

export const dev = devCommand;

async function startDenoDevServer(
  projectPath: string,
  manifest: PluginManifest,
  logger: SimpleLogger,
  client: LMStudioClient,
  { noNotify }: { noNotify: boolean },
) {
  const watcher = new DenoPluginRunnerWatcher(projectPath, logger);
  const pluginProcess = new DenoPluginProcess(projectPath, client, watcher.entryFilePath, logger, {
    noNotify,
  });

  watcher.updatedEvent.subscribe(() => {
    pluginProcess.run();
  });
  await watcher.start();
}
