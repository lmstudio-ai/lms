import chalk from "chalk";
import { UserInputError } from "../../types/UserInputError.js";
import { adapters as toolAdapters } from "./adapters/index.js";
import { type ToolAdapter, type ToolInstall, type RuledOutTool } from "./types.js";

export const TOOL_ADAPTERS: ToolAdapter[] = toolAdapters;

/**
 * Tools we deliberately do not support, with a sourced reason so the error message never reads
 * like an unexplained refusal.
 */
export const RULED_OUT_TOOLS: RuledOutTool[] = [
  {
    name: "gemini",
    aliases: ["gemini-cli"],
    displayName: "Gemini CLI",
    reason:
      "it has no native OpenAI-compatible endpoint configuration path in its stable release, " +
      "so it cannot be pointed at a local LM Studio server.",
    suggestion: "the qwen-code fork of Gemini CLI, which supports OpenAI-compatible local backends",
    source: "https://github.com/google-gemini/gemini-cli/issues/23385",
  },
  {
    name: "cursor",
    aliases: ["cursor-cli", "cursor-agent"],
    displayName: "Cursor CLI",
    reason:
      "its backend rejects localhost/private-IP base URLs even when using BYOK (bring your own " +
      "key), so it cannot reach a local LM Studio server.",
    source: "Cursor CLI BYOK behavior, verified July 2026",
  },
];

/**
 * Resolves a tool name/alias (case-insensitive) to its adapter. Throws a sourced UserInputError
 * for unknown tools and a separate, sourced explanation for tools we know about but ruled out.
 */
export function resolveAdapter(toolArg: string): ToolAdapter {
  const normalized = toolArg.trim().toLowerCase();
  const found = TOOL_ADAPTERS.find(
    adapter => adapter.name === normalized || (adapter.aliases ?? []).includes(normalized),
  );
  if (found !== undefined) {
    return found;
  }

  const ruledOut = RULED_OUT_TOOLS.find(
    tool => tool.name === normalized || (tool.aliases ?? []).includes(normalized),
  );
  if (ruledOut !== undefined) {
    const lines = [`"${ruledOut.displayName}" is not supported by "lms launch": ${ruledOut.reason}`];
    if (ruledOut.suggestion !== undefined) {
      lines.push(`Try instead: ${ruledOut.suggestion}`);
    }
    lines.push(`(Source: ${ruledOut.source})`);
    throw new UserInputError(lines.join("\n"));
  }

  throw new UserInputError(
    [
      `Unknown tool "${toolArg}".`,
      `Supported tools: ${TOOL_ADAPTERS.map(adapter => adapter.name).join(", ")}.`,
      `Run "lms launch" with no arguments to see the full catalog with install hints.`,
    ].join("\n"),
  );
}

/** Formats install instructions for a tool, e.g. for "not found on PATH" messages. */
export function formatInstallHint(install: ToolInstall): string {
  const parts: string[] = [];
  if (install.npm !== undefined) {
    parts.push(`npm i -g ${install.npm}`);
  }
  if (install.pip !== undefined) {
    parts.push(`pip install ${install.pip}`);
  }
  if (install.brew !== undefined) {
    parts.push(`brew install ${install.brew}`);
  }
  if (install.url !== undefined) {
    parts.push(install.url);
  }
  if (install.note !== undefined) {
    parts.push(install.note);
  }
  return parts.join("  or  ");
}

/** The catalog shown for `lms launch` with no tool argument. */
export function formatToolsCatalog(): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`Supported tools for "lms launch <tool>":`));
  lines.push("");
  for (const adapter of TOOL_ADAPTERS) {
    const namePart = chalk.cyan(adapter.name.padEnd(10));
    lines.push(`  ${namePart} ${adapter.displayName}`);
    const installHint = formatInstallHint(adapter.install);
    if (installHint !== "") {
      lines.push(`             ${chalk.dim(installHint)}`);
    }
  }
  if (RULED_OUT_TOOLS.length > 0) {
    lines.push("");
    lines.push(chalk.dim("Not supported:"));
    for (const tool of RULED_OUT_TOOLS) {
      lines.push(chalk.dim(`  ${tool.name.padEnd(10)} ${tool.reason}`));
    }
  }
  lines.push("");
  lines.push(`Usage: ${chalk.yellow("lms launch <tool> --model <model> [-- <tool args>]")}`);
  return lines.join("\n");
}
