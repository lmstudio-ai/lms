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
      const nextNext = text[i + 2];

      // Some terminals may wrap long, shell-escaped paths by inserting a newline after a trailing
      // backslash (e.g. "...at\\\n  6.16 PM.png"). Treat this as a single space.
      if (next === "\n") {
        i += 1;
        while (text[i + 1] !== undefined && /\s/.test(text[i + 1] ?? "")) {
          i += 1;
        }
        current += " ";
        continue;
      }
      if (next === "\r" && nextNext === "\n") {
        i += 2;
        while (text[i + 1] !== undefined && /\s/.test(text[i + 1] ?? "")) {
          i += 1;
        }
        current += " ";
        continue;
      }

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
  let trimmed = token.trim();
  if (trimmed.length === 0) return null;

  // If ESC was stripped elsewhere, some terminals leave bracketed paste markers as literal text.
  // Strip those markers defensively.
  if (trimmed.startsWith("[200~")) trimmed = trimmed.slice(5);
  if (trimmed.startsWith("[201~")) trimmed = trimmed.slice(5);
  if (trimmed.endsWith("[201~")) trimmed = trimmed.slice(0, -5);
  trimmed = trimmed.trim();
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

function splitConcatenatedAbsolutePaths(token: string): string[] {
  // Some terminals appear to paste the path twice without whitespace, e.g.
  // "/Users/...png/Users/...png". Split on the second absolute-path marker.
  const markers = ["/Users/", "/home/", "/Volumes/"];
  for (const marker of markers) {
    const first = token.indexOf(marker);
    if (first === -1) continue;
    const second = token.indexOf(marker, first + marker.length);
    if (second === -1) continue;
    const left = token.slice(0, second).trim();
    const right = token.slice(second).trim();
    return [left, right].filter(part => part.length > 0);
  }

  // Very small fallback: if a token starts with "/" and contains another "/Users/" later, split there.
  if (token.startsWith("/") && token.includes("/Users/")) {
    const secondUsers = token.indexOf("/Users/", 1);
    if (secondUsers > 0) {
      const left = token.slice(0, secondUsers).trim();
      const right = token.slice(secondUsers).trim();
      return [left, right].filter(part => part.length > 0);
    }
  }

  // Windows: repeated drive prefix
  const driveMatch = token.match(/^[A-Za-z]:\\/);
  if (driveMatch) {
    const prefix = driveMatch[0];
    const second = token.indexOf(prefix, prefix.length);
    if (second > 0) {
      const left = token.slice(0, second).trim();
      const right = token.slice(second).trim();
      return [left, right].filter(part => part.length > 0);
    }
  }

  return [token];
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
    for (const piece of splitConcatenatedAbsolutePaths(token)) {
      const normalized = normalizeDroppedPath(piece);
      if (normalized === null) continue;
      // Don't resolve relative paths; terminals typically provide absolute paths.
      results.push(normalized);
    }
  }

  return results;
}
