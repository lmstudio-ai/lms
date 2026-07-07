import { type ToolAdapter } from "../types.js";

const COMMAND = "codex";
// A synthetic provider id, scoped to this invocation only (never written to any config file).
const PROVIDER_ID = "lmslaunch";

/**
 * Codex CLI. Ships the explicit custom-provider `-c` override form (portable across versions)
 * rather than assuming a built-in "lmstudio"/"oss" provider exists in the installed release.
 * `wire_api=chat` is the broadest OpenAI-compatible mode; see the note below if it doesn't fit.
 */
export const codex: ToolAdapter = {
  name: "codex",
  displayName: "Codex CLI",
  command: COMMAND,
  install: { npm: "@openai/codex" },
  supportsContextHint: true,
  injectsModelArg: true,
  async prepare(ctx) {
    const args = [
      "-c",
      `model_providers.${PROVIDER_ID}.base_url=${ctx.openaiBaseUrl}`,
      "-c",
      `model_providers.${PROVIDER_ID}.wire_api=chat`,
      "-c",
      `model_provider=${PROVIDER_ID}`,
      "-c",
      `model=${ctx.model}`,
      "-c",
      "sandbox_mode=workspace-write",
    ];
    if (ctx.contextLength !== undefined) {
      args.push("-c", `model_context_window=${ctx.contextLength}`);
    }
    const env: Record<string, string> = {
      OPENAI_API_KEY: ctx.apiKey, // some Codex builds require a non-empty key even though unused
    };
    const notes = [
      `Using a temporary Codex provider ("${PROVIDER_ID}") with wire_api=chat. If Codex fails to ` +
        `connect, try appending an override after "--": -c model_providers.${PROVIDER_ID}.wire_api=responses`,
    ];
    return { command: COMMAND, args, env, notes };
  },
};
