import { type LaunchContext } from "./types.js";

/** Heuristic: PowerShell on Windows, unless SHELL/MSYSTEM indicate a POSIX-like shell (Git Bash, WSL). */
export function detectUsePowerShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  return platform === "win32" && env.SHELL === undefined && env.MSYSTEM === undefined;
}

function escapeForPosixShell(value: string): string {
  return value.replace(/(["\\$`])/g, "\\$1");
}

function escapeForPowerShell(value: string): string {
  return value.replace(/(["`])/g, "`$1");
}

function quoteArgIfNeeded(arg: string): string {
  return arg === "" || /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

/** Formats resolved env + command as shell-eval'able text, e.g. for `eval "$(lms launch ... --print-env)"`. */
export function formatEnvForShell(
  env: Record<string, string>,
  command: string,
  args: string[],
  usePowerShell: boolean,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    lines.push(
      usePowerShell
        ? `$env:${key}="${escapeForPowerShell(value)}"`
        : `export ${key}="${escapeForPosixShell(value)}"`,
    );
  }
  lines.push([command, ...args].map(quoteArgIfNeeded).join(" "));
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
