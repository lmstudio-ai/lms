import { type LaunchContext } from "./types.js";

/** Heuristic: PowerShell on Windows, unless SHELL/MSYSTEM indicate a POSIX-like shell (Git Bash, WSL). */
export function detectUsePowerShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  return platform === "win32" && env.SHELL === undefined && env.MSYSTEM === undefined;
}

// Single-quoting is the only fully safe strategy: inside '...' every shell metacharacter
// ($(), backticks, globs, ;, &, |, spaces) is literal. Whitespace-only or double-quote
// wrapping would leave those live, so a forwarded arg like `--flag=$(rm -rf ~)` must be
// single-quoted rather than passed through raw. See PR #594 review.

/** POSIX sh: wrap in single quotes; an embedded `'` becomes the `'\''` close/escape/reopen dance. */
function quoteForPosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** PowerShell: wrap in single quotes; an embedded `'` is doubled (`''`). */
function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`;
}

/** Formats resolved env + command as shell-eval'able text, e.g. for `eval "$(lms launch ... --print-env)"`. */
export function formatEnvForShell(
  env: Record<string, string>,
  command: string,
  args: string[],
  usePowerShell: boolean,
): string {
  const quote = usePowerShell ? quoteForPowerShell : quoteForPosix;
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    lines.push(usePowerShell ? `$env:${key}=${quote(value)}` : `export ${key}=${quote(value)}`);
  }
  const commandLine = [command, ...args].map(quote).join(" ");
  // In PowerShell a quoted first token is a string literal, not an invocation, so it must be
  // run through the `&` call operator; POSIX executes the first word after quote removal.
  lines.push(usePowerShell ? `& ${commandLine}` : commandLine);
  return lines.join("\n");
}

/** Formats the resolved launch plan for `--dry-run`. Plain text on purpose (no ANSI codes). */
export function formatLaunchPlan(
  command: string,
  args: string[],
  env: Record<string, string>,
  ctx: Pick<LaunchContext, "origin" | "model" | "contextLength">,
): string {
  const lines: string[] = [];
  lines.push("Launch plan (dry run -- nothing was spawned):");
  lines.push(`  Server:  ${ctx.origin}`);
  lines.push(
    `  Model:   ${ctx.model}` +
      (ctx.contextLength !== undefined ? ` (context: ${ctx.contextLength})` : ""),
  );
  lines.push(`  Command: ${[command, ...args].join(" ")}`);
  const envEntries = Object.entries(env);
  if (envEntries.length > 0) {
    lines.push(`  Env:`);
    for (const [key, value] of envEntries) {
      lines.push(`    ${key}=${value}`);
    }
  }
  return lines.join("\n");
}
