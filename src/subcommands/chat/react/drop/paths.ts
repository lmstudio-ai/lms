import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASCII_SEPARATOR_WHITESPACE = new Set([" ", "\n", "\r", "\t"]);

function isSeparatorWhitespace(character: string): boolean {
  return ASCII_SEPARATOR_WHITESPACE.has(character);
}

/**
 * Splits terminal drop/paste text into path-like tokens.
 *
 * Handles:
 * - whitespace-separated paths
 * - quoted paths with spaces
 * - simple backslash escapes inside double quotes (space, quote, backslash)
 */
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
        if (next !== undefined && (isSeparatorWhitespace(next) || next === `"` || next === "\\")) {
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

    // Outside quotes, allow backslash-escaped whitespace or quotes.
    if (character === "\\") {
      const next = text[i + 1];
      if (next !== undefined && (isSeparatorWhitespace(next) || next === `"` || next === "'" || next === "\\")) {
        i += 1;
        current += next;
        continue;
      }
    }

    if (isSeparatorWhitespace(character)) {
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

type ExtractDroppedFilePathsOptions = {
  requireAllPathLike?: boolean;
};

function isLikelyAbsolutePathToken(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed.length === 0) return false;

  if (trimmed.startsWith("file://")) return true;
  if (trimmed === "~") return true;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return true;
  if (trimmed.startsWith("/")) return true;
  if (trimmed.startsWith("\\\\")) return true; // UNC path
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true; // Windows drive path

  return false;
}

function normalizeDroppedPath(token: string): string | null {
  const trimmed = decodeUnicodeEscapes(token.trim());
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

function decodeUnicodeEscapes(input: string): string {
  let output = input.replace(/\\u\{([0-9a-fA-F]+)\}/g, (match, hex) => {
    const codePoint = Number.parseInt(hex, 16);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return match;
    }
    return String.fromCodePoint(codePoint);
  });
  output = output.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
    const codePoint = Number.parseInt(hex, 16);
    if (!Number.isFinite(codePoint)) return match;
    return String.fromCharCode(codePoint);
  });
  return output;
}

/**
 * Best-effort parser for drag-and-drop file paths in terminals.
 *
 * Terminals typically send dropped files as a "paste" of one or more file paths.
 * Paths may be quoted, backslash-escaped, separated by whitespace/newlines, or be file:// URIs.
 */
export function extractDroppedFilePaths(
  content: string,
  options: ExtractDroppedFilePathsOptions = {},
): string[] {
  const tokens = tokenizeDropText(content);
  if (tokens.length === 0) return [];

  if (options.requireAllPathLike === true) {
    const allPathLike = tokens.every(isLikelyAbsolutePathToken);
    if (!allPathLike) return [];
  }

  const results: string[] = [];

  for (const token of tokens) {
    const normalized = normalizeDroppedPath(token);
    if (normalized === null) {
      if (options.requireAllPathLike === true) {
        return [];
      }
      continue;
    }
    // Don't resolve relative paths; terminals typically provide absolute paths.
    results.push(normalized);
  }

  return results;
}
