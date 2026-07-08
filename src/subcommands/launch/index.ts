import { Command, Option, type OptionValues } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { chmod, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../../createClient.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { createRefinedNumberParser } from "../../types/refinedNumber.js";
import { UserInputError } from "../../types/UserInputError.js";
import { detectUsePowerShell, formatEnvForShell, formatLaunchPlan } from "./format.js";
import { formatInstallHint, formatToolsCatalog, resolveAdapter } from "./registry.js";
import { resolveModelForLaunch } from "./resolveModel.js";
import { ensureRestServer } from "./serverReady.js";
import { isOnPath, spawnToolAndWait } from "./spawnTool.js";
import { type LaunchContext, type PreparedLaunch } from "./types.js";

type LaunchCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    model?: string;
    contextLength?: number;
    apiKey?: string;
    printEnv?: boolean;
    dryRun?: boolean;
    serverCheck?: boolean; // false when --no-server-check is passed
    yes?: boolean;
  };

const launchCommand = new Command<[], LaunchCommandOptions>()
  .name("launch")
  .description(
    text`
      Launch a third-party coding CLI (Claude Code, Codex CLI, GitHub Copilot CLI, aider, opencode,
      droid) wired up to talk to the local LM Studio server: ensures the server is running, resolves
      or loads the model, translates everything into the tool's own configuration surface, and hands
      the terminal over to it.
    `,
  )
  .argument("[tool]", `The coding tool to launch, e.g. "claude". Omit to see the full catalog.`)
  .argument(
    "[toolArgs...]",
    text`
      Arguments forwarded to the tool. Tokens matching lms's own flags (e.g. --model, -c,
      --dry-run) are consumed by lms wherever they appear; pass "--" to forward every following
      token to the tool verbatim.
    `,
  )
  .option(
    "-m, --model <model>",
    text`
      Model to use, e.g. "openai/gpt-oss-20b". If omitted and exactly one model is loaded, uses it;
      otherwise prompts interactively (or errors under -y).
    `,
  )
  .addOption(
    new Option(
      "-c, --context-length <n>",
      text`
        Context length to load the model with, and to feed the tool's auto-compaction hint (when
        one is available). Defaults to the model's already-loaded/native context.
      `,
    ).argParser(createRefinedNumberParser({ integer: true, min: 1 })),
  )
  .option(
    "--api-key <token>",
    `Bearer token for the local endpoint (default "lmstudio").`,
  )
  .option("--print-env", `Print the resolved command + env (shell-eval'able), then exit.`)
  .option("--dry-run", `Resolve everything and print the plan, but don't launch.`)
  .option("--no-server-check", `Skip the REST server readiness probe/auto-start.`)
  .option(
    "-y, --yes",
    `Assume "yes": no interactive prompts; auto-confirm model loads and config writes.`,
  )
  // allowUnknownOption lets the tool's own flags flow into `toolArgs` untouched. We deliberately
  // do NOT use passThroughOptions: it stops parsing at the first operand (the tool name), which
  // would divert lms's own flags placed after it (e.g. `lms launch claude --dry-run`) into
  // toolArgs and silently forward them to the tool instead of honoring them. Without it, lms
  // consumes its known flags wherever they appear; `--` remains the escape hatch to force
  // everything after it through to the tool verbatim.
  .allowUnknownOption(true);

addCreateClientOptions(launchCommand);
addLogLevelOptions(launchCommand);

async function makeLaunchTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lms-launch-"));
  try {
    await chmod(dir, 0o700);
  } catch {
    // Best-effort; irrelevant on platforms without POSIX permission bits (e.g. Windows).
  }
  return dir;
}

launchCommand.action(async (tool, toolArgs, options: LaunchCommandOptions) => {
  const logger = createLogger(options);

  if (tool === undefined) {
    console.info(formatToolsCatalog());
    return;
  }

  const adapter = resolveAdapter(tool);

  const modelQuery = options.model;
  const yes = options.yes ?? false;

  // For a local launch, --port designates the REST endpoint the tool talks to, not the SDK/control
  // channel -- that must stay on createClient's findOrStartLlmster path. Feeding --port into
  // createClient diverts it to a direct probe that exits if the REST server is stopped, before
  // ensureRestServer ever runs, defeating the advertised auto-start (e.g. `launch claude --port
  // 4321` on a stopped server). Only remote launches, which connect straight to host:port, keep it.
  await using client = await createClient(logger, {
    ...options,
    port: options.host === undefined ? undefined : options.port,
  });

  const { host, port, origin } = await ensureRestServer(client, logger, {
    host: options.host,
    port: options.port,
    skipCheck: options.serverCheck === false,
  });

  const resolved = await resolveModelForLaunch(client, logger, {
    model: modelQuery,
    contextLength: options.contextLength,
    yes,
    printEnv: options.printEnv === true,
  });

  if (options.contextLength !== undefined && !adapter.supportsContextHint) {
    const effectiveContext = resolved.contextLength ?? options.contextLength;
    logger.warnText`
      "${adapter.name}" has no verified context-length knob; the model was loaded at
      ${String(effectiveContext)} tokens, which is the effective window.
    `;
  }

  const workDir = await makeLaunchTempDir();
  const ctx: LaunchContext = {
    client,
    logger,
    host,
    port,
    origin,
    openaiBaseUrl: `${origin}/v1`,
    model: resolved.identifier,
    contextLength: resolved.contextLength,
    apiKey: options.apiKey ?? "lmstudio",
    yes,
    workDir,
    printEnv: options.printEnv === true,
  };

  let prepared: PreparedLaunch | undefined;
  try {
    prepared = await adapter.prepare(ctx);
    const childArgs = [...prepared.args, ...toolArgs];

    prepared.notes?.forEach(note => logger.warn(note));

    if (options.printEnv === true) {
      const usePowerShell = detectUsePowerShell(process.platform, process.env);
      process.stdout.write(
        formatEnvForShell(prepared.env, prepared.command, childArgs, usePowerShell) + "\n",
      );
      return;
    }
    if (options.dryRun === true) {
      console.info(formatLaunchPlan(prepared.command, childArgs, prepared.env, ctx));
      return;
    }

    if (!(await isOnPath(prepared.command))) {
      throw new UserInputError(
        [
          `Could not find "${prepared.command}" on your PATH.`,
          `Install ${adapter.displayName}: ${formatInstallHint(adapter.install)}`,
        ].join("\n"),
      );
    }

    logger.info(`Launching ${adapter.displayName}...`);
    process.exitCode = await spawnToolAndWait(prepared.command, childArgs, prepared.env);
  } finally {
    // --print-env emits a command the user runs later in their own shell, so anything that command
    // depends on -- aider's --model-metadata-file under workDir, droid's ~/.factory settings entry --
    // must outlive this process. Skip teardown in that mode only; the spawn, dry-run, and error
    // paths still clean up here.
    if (options.printEnv !== true) {
      await prepared?.cleanup?.();
      await rm(workDir, { recursive: true, force: true });
    }
  }
});

export const launch = launchCommand;
