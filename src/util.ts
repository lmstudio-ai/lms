import { execaSync } from "execa";

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * Runs a command synchronously and returns the result.
 */
export function runCommandSync(command: string, options = {}): ExecResult {
  const [cmd, ...args] = command.split(" ");

  const result = execaSync(cmd, args, {
    encoding: "utf8",
    reject: false,
    ...options,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.exitCode ?? 0,
  };
}
