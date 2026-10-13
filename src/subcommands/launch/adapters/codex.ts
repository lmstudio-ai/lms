import { type ToolAdapter } from "../types.js";

const COMMAND = "codex";
// A synthetic provider id, scoped to this invocation only (never written to any config file).
const PROVIDER_ID = "lmslaunch";

/**
 * Codex CLI. Ships the explicit custom-provider `-c` override form (portable across versions)
 * rather than assuming a built-in "lmstudio"/"oss" provider exists in the installed release.
 * Uses wire_api=responses: current Codex removed Chat Completions support (Feb 2026) and only
 * speaks the Responses API, which LM Studio serves at /v1/responses. See the note for the legacy
 * chat fallback (older Codex + older LM Studio).
 */
export const codex: ToolAdapter = {
  name: "codex",
  displayName: "Codex CLI",
  command: COMMAND,
  install: { npm: "@openai/codex" },
  supportsContextHint: true,
  async prepare(ctx) {
    const args = [
      "-c",
      `model_providers.${PROVIDER_ID}.base_url=${ctx.openaiBaseUrl}`,
      "-c",
      `model_providers.${PROVIDER_ID}.wire_api=responses`,
      "-c",
      // Names the env var Codex reads the bearer token from. Without env_key the custom provider
      // sends no Authorization header, so `--api-key` can't authenticate a secured LM Studio endpoint.
      `model_providers.${PROVIDER_ID}.env_key=OPENAI_API_KEY`,
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
      // Referenced by model_providers.<id>.env_key above; Codex forwards it as the bearer token.
      OPENAI_API_KEY: ctx.apiKey,
    };
    const notes = [
      `Temporary Codex provider ("${PROVIDER_ID}") using wire_api=responses (current Codex dropped ` +
        `Chat Completions; LM Studio serves /v1/responses). On a pre-2026 Codex without Responses ` +
        `support, override after "--": -c model_providers.${PROVIDER_ID}.wire_api=chat`,
    ];
    return { command: COMMAND, args, env, notes };
  },
};
