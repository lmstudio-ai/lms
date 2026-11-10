import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { aider } from "./adapters/aider.js";
import { claude } from "./adapters/claude.js";
import { codex } from "./adapters/codex.js";
import { copilot } from "./adapters/copilot.js";
import {
  droid,
  mergeDroidSettings,
  removeDroidSettingsEntry,
  type DroidSettings,
} from "./adapters/droid.js";
import { opencode } from "./adapters/opencode.js";
import { detectUsePowerShell, formatEnvForShell, formatLaunchPlan } from "./format.js";
import { formatInstallHint, resolveAdapter } from "./registry.js";
import { SIGNAL_EXIT } from "./spawnTool.js";
import { type LaunchContext } from "./types.js";

function makeCtx(overrides: Partial<LaunchContext> = {}): LaunchContext {
  return {
    client: {} as LMStudioClient,
    logger: {} as SimpleLogger,
    host: "127.0.0.1",
    port: 1234,
    origin: "http://127.0.0.1:1234",
    openaiBaseUrl: "http://127.0.0.1:1234/v1",
    model: "openai/gpt-oss-20b",
    contextLength: 32000,
    apiKey: "lmstudio",
    yes: false,
    workDir: "/lms-launch-test-workdir-unused",
    printEnv: false,
    dryRun: false,
    ...overrides,
  };
}

describe("SIGNAL_EXIT", () => {
  it("maps common signals to 128 + n exit codes", () => {
    expect(SIGNAL_EXIT.SIGINT).toBe(130);
    expect(SIGNAL_EXIT.SIGTERM).toBe(143);
    expect(SIGNAL_EXIT.SIGHUP).toBe(129);
    expect(SIGNAL_EXIT.SIGQUIT).toBe(131);
  });
});

describe("resolveAdapter", () => {
  it("resolves a known tool case-insensitively", () => {
    expect(resolveAdapter("claude").name).toBe("claude");
    expect(resolveAdapter("Claude").name).toBe("claude");
  });

  it("resolves via alias", () => {
    expect(resolveAdapter("claude-code").name).toBe("claude");
  });

  it("throws a sourced explanation for a ruled-out tool", () => {
    expect(() => resolveAdapter("gemini")).toThrow(/qwen-code/);
    expect(() => resolveAdapter("cursor")).toThrow(/BYOK/);
  });

  it("throws for a fully unknown tool", () => {
    expect(() => resolveAdapter("not-a-real-tool")).toThrow(/Unknown tool/);
  });
});

describe("formatInstallHint", () => {
  it("joins available install methods", () => {
    expect(formatInstallHint({ npm: "@foo/bar" })).toBe("npm i -g @foo/bar");
    expect(formatInstallHint({ pip: "foo" })).toBe("pip install foo");
    expect(formatInstallHint({ npm: "@foo/bar", url: "https://example.test" })).toBe(
      "npm i -g @foo/bar  or  https://example.test",
    );
  });
});

describe("detectUsePowerShell", () => {
  it("prefers PowerShell on Windows with no POSIX shell markers", () => {
    expect(detectUsePowerShell("win32", {})).toBe(true);
  });

  it("defers to a POSIX shell on Windows when SHELL is set (Git Bash/WSL)", () => {
    expect(detectUsePowerShell("win32", { SHELL: "/bin/bash" })).toBe(false);
  });

  it("defers to a POSIX shell on Windows when MSYSTEM is set", () => {
    expect(detectUsePowerShell("win32", { MSYSTEM: "MINGW64" })).toBe(false);
  });

  it("is false on non-Windows platforms", () => {
    expect(detectUsePowerShell("linux", {})).toBe(false);
    expect(detectUsePowerShell("darwin", {})).toBe(false);
  });
});

describe("formatEnvForShell", () => {
  it("single-quotes POSIX export lines and every command token", () => {
    const out = formatEnvForShell({ FOO: "bar" }, "claude", ["--model", "a b"], false);
    expect(out).toBe(`export FOO='bar'\n'claude' '--model' 'a b'`);
  });

  it("single-quotes PowerShell $env: lines and prefixes the command with the call operator", () => {
    const out = formatEnvForShell({ FOO: "bar" }, "claude", [], true);
    expect(out).toBe(`$env:FOO='bar'\n& 'claude'`);
  });

  it("keeps POSIX shell metacharacters inert (no command substitution/globbing)", () => {
    const out = formatEnvForShell({}, "claude", ["--flag=$(touch pwned)", "a;b&c|d *"], false);
    expect(out).toBe(`'claude' '--flag=$(touch pwned)' 'a;b&c|d *'`);
  });

  it("keeps PowerShell metacharacters inert", () => {
    const out = formatEnvForShell({ K: "$(danger)" }, "claude", ["a`b", "$x"], true);
    expect(out).toBe(`$env:K='$(danger)'\n& 'claude' 'a\`b' '$x'`);
  });

  it("escapes embedded single quotes per shell", () => {
    expect(formatEnvForShell({ K: "a'b" }, "tool", [], false)).toBe(`export K='a'\\''b'\n'tool'`);
    expect(formatEnvForShell({ K: "a'b" }, "tool", [], true)).toBe(`$env:K='a''b'\n& 'tool'`);
  });
});

describe("formatLaunchPlan", () => {
  it("includes the server, model, and command", () => {
    const out = formatLaunchPlan("claude", ["--model", "x"], { FOO: "bar" }, {
      origin: "http://127.0.0.1:1234",
      model: "openai/gpt-oss-20b",
      contextLength: 32000,
    });
    expect(out).toContain("http://127.0.0.1:1234");
    expect(out).toContain("openai/gpt-oss-20b");
    expect(out).toContain("(context: 32000)");
    expect(out).toContain("claude --model x");
    expect(out).toContain("FOO=bar");
  });
});

describe("claude adapter", () => {
  it("sets env with the bare origin (no /v1) and pins all four tiers and the subagent model", async () => {
    const prepared = await claude.prepare(makeCtx());
    expect(prepared.command).toBe("claude");
    expect(prepared.args).toEqual([]);
    expect(prepared.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:1234");
    expect(prepared.env.ANTHROPIC_AUTH_TOKEN).toBe("lmstudio");
    expect(prepared.env.ANTHROPIC_MODEL).toBe("openai/gpt-oss-20b");
    expect(prepared.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("openai/gpt-oss-20b");
    expect(prepared.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("openai/gpt-oss-20b");
    expect(prepared.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("openai/gpt-oss-20b");
    expect(prepared.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("openai/gpt-oss-20b");
    expect(prepared.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("openai/gpt-oss-20b");
    expect(prepared.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("32000");
  });

  it("omits the auto-compact window when context length is unknown", async () => {
    const prepared = await claude.prepare(makeCtx({ contextLength: undefined }));
    expect(prepared.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
  });

  it("warns when the model id starts with claude- (first-party window override)", async () => {
    const withPrefix = await claude.prepare(makeCtx({ model: "claude-3-opus" }));
    expect(withPrefix.notes?.some(note => note.includes("claude-"))).toBe(true);

    const withoutPrefix = await claude.prepare(makeCtx());
    expect(withoutPrefix.notes ?? []).toEqual([]);
  });
});

describe("codex adapter", () => {
  it("uses the /v1 OpenAI base URL and an explicit custom provider", async () => {
    const prepared = await codex.prepare(makeCtx());
    expect(prepared.args).toEqual([
      "-c",
      "model_providers.lmslaunch.base_url=http://127.0.0.1:1234/v1",
      "-c",
      "model_providers.lmslaunch.wire_api=responses",
      "-c",
      "model_providers.lmslaunch.env_key=OPENAI_API_KEY",
      "-c",
      "model_provider=lmslaunch",
      "-c",
      "model=openai/gpt-oss-20b",
      "-c",
      "sandbox_mode=workspace-write",
      "-c",
      "model_context_window=32000",
    ]);
    // env_key must name the env var we populate, or Codex sends no bearer token to a secured endpoint.
    expect(prepared.args).toContain("model_providers.lmslaunch.env_key=OPENAI_API_KEY");
    expect(prepared.env.OPENAI_API_KEY).toBe("lmstudio");
  });

  it("omits model_context_window when context length is unknown", async () => {
    const prepared = await codex.prepare(makeCtx({ contextLength: undefined }));
    expect(prepared.args.join(" ")).not.toContain("model_context_window");
    expect(prepared.args).toHaveLength(12);
  });
});

describe("copilot adapter", () => {
  it("sets the /v1 base URL and has no context hint", async () => {
    const prepared = await copilot.prepare(makeCtx());
    expect(prepared.env.COPILOT_PROVIDER_BASE_URL).toBe("http://127.0.0.1:1234/v1");
    expect(prepared.env.COPILOT_MODEL).toBe("openai/gpt-oss-20b");
    expect(prepared.env.COPILOT_OFFLINE).toBe("true");
    expect(copilot.supportsContextHint).toBe(false);
  });
});

describe("aider adapter", () => {
  it("prefixes the model with lm_studio/ and requires a non-empty key", async () => {
    const prepared = await aider.prepare(makeCtx({ contextLength: undefined }));
    expect(prepared.args).toEqual(["--model", "lm_studio/openai/gpt-oss-20b"]);
    expect(prepared.env.LM_STUDIO_API_BASE).toBe("http://127.0.0.1:1234/v1");
    expect(prepared.env.LM_STUDIO_API_KEY).toBe("lmstudio");
  });

  it("falls back to a non-empty key if apiKey was somehow blank", async () => {
    const prepared = await aider.prepare(makeCtx({ contextLength: undefined, apiKey: "" }));
    expect(prepared.env.LM_STUDIO_API_KEY).toBe("lmstudio");
  });

  it("writes a model metadata file and passes --model-metadata-file when context length is known", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "lms-launch-aider-test-"));
    try {
      const prepared = await aider.prepare(makeCtx({ workDir }));
      const flagIndex = prepared.args.indexOf("--model-metadata-file");
      expect(flagIndex).toBeGreaterThan(-1);
      const metadataPath = prepared.args[flagIndex + 1];
      const raw = await readFile(metadataPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed["lm_studio/openai/gpt-oss-20b"]).toEqual({
        max_input_tokens: 32000,
        litellm_provider: "lm_studio",
        mode: "chat",
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});

describe("opencode adapter", () => {
  it("reports no verified context knob (OpenCode's limit needs a paired output cap we can't supply)", () => {
    expect(opencode.supportsContextHint).toBe(false);
  });

  it("builds an inline config with the /v1 base URL and no limit block", async () => {
    const prepared = await opencode.prepare(makeCtx());
    const config = JSON.parse(prepared.env.OPENCODE_CONFIG_CONTENT);
    expect(config.model).toBe("lmstudio/openai/gpt-oss-20b");
    expect(config.small_model).toBe("lmstudio/openai/gpt-oss-20b");
    // The injected provider must survive an inherited allowlist/blocklist and a provider policy.
    expect(config.enabled_providers).toEqual(["lmstudio"]);
    expect(config.disabled_providers).toEqual([]);
    expect(config.experimental.policies).toEqual([
      { effect: "allow", action: "provider.use", resource: "lmstudio" },
    ]);
    expect(config.provider.lmstudio.options.baseURL).toBe("http://127.0.0.1:1234/v1");
    expect(config.provider.lmstudio.options.apiKey).toBe("lmstudio");
    // OpenCode's `limit` requires both context and output; we only know context, so we emit no
    // limit block rather than an invalid partial one -- even when a context length is known.
    expect(config.provider.lmstudio.models["openai/gpt-oss-20b"].limit).toBeUndefined();
  });

  it("still emits no limit block when the context length is unknown", async () => {
    const prepared = await opencode.prepare(makeCtx({ contextLength: undefined }));
    const config = JSON.parse(prepared.env.OPENCODE_CONFIG_CONTENT);
    expect(config.provider.lmstudio.models["openai/gpt-oss-20b"].limit).toBeUndefined();
  });
});

describe("droid adapter", () => {
  it("reports no verified context knob (Factory BYOK exposes no context-window field)", () => {
    expect(droid.supportsContextHint).toBe(false);
  });

  it("is side-effect-free under --dry-run (no settings write, no cleanup)", async () => {
    // dryRun returns before any fs access, so this does not touch ~/.factory/settings.json.
    const prepared = await droid.prepare(makeCtx({ dryRun: true }));
    expect(prepared.command).toBe("droid");
    expect(prepared.cleanup).toBeUndefined();
    expect(prepared.notes?.some(note => note.includes("Would write"))).toBe(true);
  });
});

describe("mergeDroidSettings", () => {
  const entry = {
    displayName: "LM Studio (lms launch)",
    model: "openai/gpt-oss-20b",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: "lmstudio",
    provider: "generic-chat-completion-api",
  };

  it("adds the entry to an empty settings object", () => {
    const merged = mergeDroidSettings({}, entry);
    expect(merged.customModels).toEqual([entry]);
  });

  it("replaces a prior entry with the same displayName instead of duplicating it (idempotent)", () => {
    const older = { ...entry, model: "old/model" };
    const merged = mergeDroidSettings({ customModels: [older] }, entry);
    expect(merged.customModels).toEqual([entry]);
  });

  it("preserves unrelated existing settings and models", () => {
    const other = { ...entry, displayName: "Some Other Model" };
    const existing: DroidSettings = { customModels: [other], someOtherKey: "value" };
    const merged = mergeDroidSettings(existing, entry);
    expect(merged.someOtherKey).toBe("value");
    expect(merged.customModels).toEqual([other, entry]);
  });
});

describe("removeDroidSettingsEntry", () => {
  const entry = {
    displayName: "LM Studio (lms launch)",
    model: "openai/gpt-oss-20b",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: "lmstudio",
    provider: "generic-chat-completion-api",
  };

  it("removes only our entry, preserving models the session added meanwhile", () => {
    const other = { ...entry, displayName: "Some Other Model" };
    const sessionAdded = { ...entry, displayName: "Droid Added This" };
    const current: DroidSettings = { customModels: [other, entry, sessionAdded] };
    const cleaned = removeDroidSettingsEntry(current, entry.displayName);
    expect(cleaned.customModels).toEqual([other, sessionAdded]);
  });

  it("preserves unrelated top-level settings changed during the session", () => {
    const current: DroidSettings = { customModels: [entry], someOtherKey: "changed" };
    const cleaned = removeDroidSettingsEntry(current, entry.displayName);
    expect(cleaned.someOtherKey).toBe("changed");
    expect(cleaned.customModels).toBeUndefined();
  });

  it("drops the customModels key when only our entry was present", () => {
    const cleaned = removeDroidSettingsEntry({ customModels: [entry] }, entry.displayName);
    expect(cleaned).toEqual({});
  });

  it("is a no-op when our entry is absent", () => {
    const other = { ...entry, displayName: "Some Other Model" };
    const cleaned = removeDroidSettingsEntry({ customModels: [other] }, entry.displayName);
    expect(cleaned.customModels).toEqual([other]);
  });
});
