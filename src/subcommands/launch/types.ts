import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";

/** Everything an adapter needs, fully resolved. */
export interface LaunchContext {
  client: LMStudioClient;
  logger: SimpleLogger;
  host: string; // loopback host the REST server is reachable on (e.g. "127.0.0.1")
  port: number; // live REST port
  origin: string; // `http://${host}:${port}` (no trailing slash, no /v1)
  openaiBaseUrl: string; // `${origin}/v1`
  model: string; // resolved model identifier (from getModelInfo().identifier)
  contextLength?: number; // read back from the loaded model, if known
  apiKey: string; // bearer token for the local endpoint (default "lmstudio")
  yes: boolean;
  workDir: string; // per-launch temp dir (0700) for metadata/config files; cleaned up after (kept under --print-env)
  printEnv: boolean; // true under --print-env: config the emitted command references must outlive this process
  dryRun: boolean; // true under --dry-run: prepare() must be side-effect-free (no writes, no prompts)
}

/** What an adapter produces. */
export interface PreparedLaunch {
  command: string; // e.g. "claude"
  args: string[]; // adapter args (forwarded toolArgs are appended by index.ts)
  env: Record<string, string>; // extra env merged over process.env
  notes?: string[]; // shown to the user before launch
  cleanup?: () => Promise<void>; // e.g. remove a written config file; always run in finally
}

export interface ToolInstall {
  npm?: string;
  pip?: string;
  brew?: string;
  url?: string;
  note?: string;
}

export interface ToolAdapter {
  name: string;
  aliases?: string[];
  displayName: string;
  command: string; // binary name resolved on PATH
  install: ToolInstall;
  /** Does this adapter have a *verified* per-tool context-length knob? */
  supportsContextHint: boolean;
  prepare(ctx: LaunchContext): Promise<PreparedLaunch>;
}

/** An entry in the registry for a tool we know about but deliberately don't support. */
export interface RuledOutTool {
  name: string;
  aliases?: string[];
  displayName: string;
  reason: string;
  suggestion?: string;
  source: string;
}
