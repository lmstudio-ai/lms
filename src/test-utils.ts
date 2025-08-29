import { spawnSync, type SpawnSyncOptions } from "child_process";

export interface TestExecResult {
  stdout: string;
  stderr: string;
  status: number;
}
export const TEST_MODEL_EXPECTED = "gemma-3-1b";

/**
 * Runs a command synchronously and returns the result.
 */
export function testRunCommandSync(
  cmd: string,
  args: string[],
  options: SpawnSyncOptions = {},
): TestExecResult {
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

export const TEST_CLI_PATH = "../../../../publish/cli/dist/index.js";
