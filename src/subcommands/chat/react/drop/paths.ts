import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function tokenizeDropText(raw: string): string[] {
  const text = raw.trim();
  if (text.length === 0) return [];

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === undefined) continue;

    if (quote !== null) {
      if (character === quote) {
        quote = null;
        continue;
      }
      // In double quotes, terminals may escape spaces/quotes with backslash.
      if (quote === '"' && character === "\\") {
        const next = text[i + 1];
        if (next !== undefined && (/\s/.test(next) || next === `"` || next === "\\")) {
          i += 1;
          current += next;
          continue;
        }
      }
      current += character;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "\\") {
      const next = text[i + 1];
      // Only treat backslash as an escape when it is used to escape whitespace/quotes.
      // This avoids breaking Windows paths like C:\Users\me\cat.png.
      if (next !== undefined && (/\s/.test(next) || next === `"` || next === "'" || next === "\\")) {
        i += 1;
        current += next;
        continue;
      }
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function normalizeDroppedPath(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;

  // file:// URI (common in some terminals / desktop environments)
  if (trimmed.startsWith("file://")) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return null;
    }
  }

  // ~ or ~/path
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return trimmed;
}

/**
 * Best-effort parser for drag-and-drop file paths in terminals.
 *
 * Terminals typically send dropped files as a "paste" of one or more file paths.
 * Paths may be quoted, backslash-escaped, separated by whitespace/newlines, or be file:// URIs.
 */
export function extractDroppedFilePaths(content: string): string[] {
  const tokens = tokenizeDropText(content);
  const results: string[] = [];

  for (const token of tokens) {
    const normalized = normalizeDroppedPath(token);
    if (normalized === null) continue;
    // Don't resolve relative paths; terminals typically provide absolute paths.
    results.push(normalized);
  }

  return results;
}

