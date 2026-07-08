import { type ToolAdapter } from "../types.js";

const COMMAND = "opencode";

/**
 * opencode. Config is delivered inline via `OPENCODE_CONFIG_CONTENT`, which dodges the Windows
 * `~/.config` vs `%APPDATA%` ambiguity a temp-file-based `OPENCODE_CONFIG` path would raise.
 *
 * OpenCode's model `limit` object requires BOTH `context` and `output` (per
 * https://opencode.ai/config.json); a `context`-only block is invalid and OpenCode rejects/ignores
 * it. We only know the loaded context window, not a real output cap -- and inventing one would
 * advertise a bogus response budget -- so we emit no `limit` at all and let the LM Studio server
 * enforce the window it loaded the model at. `supportsContextHint` is therefore false.
 */
export const opencode: ToolAdapter = {
  name: "opencode",
  displayName: "opencode",
  command: COMMAND,
  install: { url: "https://opencode.ai" },
  supportsContextHint: false,
  async prepare(ctx) {
    const config = {
      $schema: "https://opencode.ai/config.json",
      model: `lmstudio/${ctx.model}`,
      // OpenCode merges config sources rather than replacing them, and `small_model` (title
      // generation and other lightweight/background tasks) is a separate setting. Without pinning
      // it, a global/project `small_model` would keep routing those tasks to a previously
      // configured provider, so point it at the same local model as the main one.
      small_model: `lmstudio/${ctx.model}`,
      provider: {
        lmstudio: {
          npm: "@ai-sdk/openai-compatible",
          name: "LM Studio (local)",
          options: { baseURL: ctx.openaiBaseUrl, apiKey: ctx.apiKey },
          models: { [ctx.model]: {} },
        },
      },
    };
    const env: Record<string, string> = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    };
    return { command: COMMAND, args: [], env };
  },
};
