import { type ToolAdapter } from "../types.js";

const COMMAND = "opencode";

/**
 * opencode. Config is delivered inline via `OPENCODE_CONFIG_CONTENT`, which dodges the Windows
 * `~/.config` vs `%APPDATA%` ambiguity a temp-file-based `OPENCODE_CONFIG` path would raise.
 */
export const opencode: ToolAdapter = {
  name: "opencode",
  displayName: "opencode",
  command: COMMAND,
  install: { url: "https://opencode.ai" },
  supportsContextHint: true,
  async prepare(ctx) {
    const modelConfig: { limit?: { context: number } } = {};
    if (ctx.contextLength !== undefined) {
      modelConfig.limit = { context: ctx.contextLength };
    }
    const config = {
      $schema: "https://opencode.ai/config.json",
      model: `lmstudio/${ctx.model}`,
      provider: {
        lmstudio: {
          npm: "@ai-sdk/openai-compatible",
          name: "LM Studio (local)",
          options: { baseURL: ctx.openaiBaseUrl, apiKey: ctx.apiKey },
          models: { [ctx.model]: modelConfig },
        },
      },
    };
    const env: Record<string, string> = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    };
    return { command: COMMAND, args: [], env };
  },
};
