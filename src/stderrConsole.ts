import { Console } from "node:console";

export function createStderrConsole(): Console {
  return new Console({
    stdout: process.stderr,
    stderr: process.stderr,
  });
}
