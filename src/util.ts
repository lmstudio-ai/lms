import { spawnSync, type SpawnSyncOptions } from "child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * Runs a command synchronously and returns the result.
 */
export function runCommandSync(
  cmd: string,
  args: string[],
  options: SpawnSyncOptions = {},
): ExecResult {
  const result = spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf-8",
    shell: true,
    ...options,
  });

  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    status: result.status ?? (result.error ? 1 : 0),
  };
}
