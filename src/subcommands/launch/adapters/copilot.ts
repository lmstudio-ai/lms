import { type ToolAdapter } from "../types.js";

const COMMAND = "copilot";

/**
 * GitHub Copilot CLI (the standalone `@github/copilot` package, NOT `gh copilot`). Env-only.
 * Verified names against https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models
 */
export const copilot: ToolAdapter = {
  name: "copilot",
  displayName: "GitHub Copilot CLI",
  command: COMMAND,
  install: { npm: "@github/copilot" },
  // No verified per-tool context knob: context lives entirely in the model load (layer 1).
  supportsContextHint: false,
  async prepare(ctx) {
    const env: Record<string, string> = {
      COPILOT_PROVIDER_BASE_URL: ctx.openaiBaseUrl,
      COPILOT_MODEL: ctx.model,
      COPILOT_PROVIDER_API_KEY: ctx.apiKey,
      COPILOT_PROVIDER_TYPE: "openai",
      COPILOT_OFFLINE: "true", // do not contact GitHub servers
    };
    return { command: COMMAND, args: [], env };
  },
};
