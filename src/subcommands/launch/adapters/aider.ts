import { writeFile } from "fs/promises";
import { join } from "path";
import { type LaunchContext, type ToolAdapter } from "../types.js";

const COMMAND = "aider";

async function writeModelMetadataFile(ctx: LaunchContext): Promise<string> {
  const metadataPath = join(ctx.workDir, ".aider.model.metadata.json");
  const metadata = {
    [`lm_studio/${ctx.model}`]: {
      max_input_tokens: ctx.contextLength,
      litellm_provider: "lm_studio",
      mode: "chat",
    },
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  return metadataPath;
}

/**
 * Aider, via its LM Studio-native provider path. Env for the endpoint, CLI arg for model
 * selection (no env equivalent exists). Verified against
 * https://aider.chat/docs/llms/openai-compat.html
 */
export const aider: ToolAdapter = {
  name: "aider",
  displayName: "Aider",
  command: COMMAND,
  install: { pip: "aider-chat", url: "https://aider.chat/docs/llms/openai-compat.html" },
  supportsContextHint: true,
  injectsModelArg: true,
  async prepare(ctx) {
    const env: Record<string, string> = {
      LM_STUDIO_API_BASE: ctx.openaiBaseUrl,
      // Must be non-empty -- aider's OpenAI-compatible client rejects an empty bearer token.
      LM_STUDIO_API_KEY: ctx.apiKey !== "" ? ctx.apiKey : "lmstudio",
    };
    const args = ["--model", `lm_studio/${ctx.model}`];
    if (ctx.contextLength !== undefined) {
      const metadataPath = await writeModelMetadataFile(ctx);
      args.push("--model-metadata-file", metadataPath);
    }
    return { command: COMMAND, args, env };
  },
};
