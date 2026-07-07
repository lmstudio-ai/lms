import { type ToolAdapter } from "../types.js";

const COMMAND = "claude";
const CLAUDE_FIRST_PARTY_MODEL_ID_RE = /^claude-/i;

/**
 * Claude Code. Env-only: base URL is the bare origin (Claude Code appends `/v1/messages` itself).
 * Verified against https://code.claude.com/docs/en/env-vars and https://lmstudio.ai/blog/claudecode.
 */
export const claude: ToolAdapter = {
  name: "claude",
  aliases: ["claude-code"],
  displayName: "Claude Code",
  command: COMMAND,
  install: { npm: "@anthropic-ai/claude-code", url: "https://lmstudio.ai/blog/claudecode" },
  supportsContextHint: true,
  async prepare(ctx) {
    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: ctx.origin, // NOT ctx.openaiBaseUrl -- no /v1 suffix here
      ANTHROPIC_AUTH_TOKEN: ctx.apiKey,
      ANTHROPIC_MODEL: ctx.model,
      // Pin all four tiers so background/subagent calls don't target a nonexistent Anthropic
      // model id.
      ANTHROPIC_DEFAULT_OPUS_MODEL: ctx.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: ctx.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: ctx.model,
      ANTHROPIC_DEFAULT_FABLE_MODEL: ctx.model,
    };
    const notes: string[] = [];
    if (ctx.contextLength !== undefined) {
      env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(ctx.contextLength);
    }
    if (CLAUDE_FIRST_PARTY_MODEL_ID_RE.test(ctx.model)) {
      notes.push(
        `Model id "${ctx.model}" starts with "claude-"; Claude Code will assume a first-party ` +
          `200K window and ignore CLAUDE_CODE_AUTO_COMPACT_WINDOW. Load with ` +
          `"lms load --identifier <other-name>" to avoid this.`,
      );
    }
    // args is empty on purpose: any passthrough "--model" the user typed after "claude" is
    // forwarded untouched by index.ts, and Claude Code's own --model flag takes precedence over
    // the env vars above, so nothing here needs to inject or dedupe a --model arg.
    return { command: COMMAND, args: [], env, notes };
  },
};
