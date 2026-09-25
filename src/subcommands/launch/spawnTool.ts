import { text } from "@lmstudio/lms-common";
import spawn from "cross-spawn";
import { UserInputError } from "../../types/UserInputError.js";

/** POSIX signal -> conventional exit code (128 + n), matching common shell conventions. */
export const SIGNAL_EXIT: Record<string, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
  SIGQUIT: 131,
};

/**
 * Spawns the target tool with the terminal handed over (stdio: inherit) and resolves once it
 * exits, with the exit code (or a signal-derived one) it should propagate as.
 *
 * Uses `cross-spawn` (never `shell: true` on user-controlled input): it resolves npm's
 * `.cmd`/`.bat` shims via `PATHEXT` on Windows and shells out to `cmd.exe /d /s /c` internally
 * with correct escaping, so there is no command-injection surface and no bare-`spawn` `EINVAL` on
 * Windows for `.cmd`-shimmed binaries.
 */
export async function spawnToolAndWait(
  command: string,
  args: string[],
  extraEnv: Record<string, string>,
): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });

    // With stdio: "inherit", the child shares the console/foreground process group and receives
    // Ctrl-C directly (on POSIX and in the Windows console alike). The parent must not exit first
    // on SIGINT -- a no-op listener keeps `lms` alive until the child actually exits so we can
    // propagate its real status; SIGTERM is forwarded explicitly since it isn't console-delivered.
    const onSigint = () => {};
    const onSigterm = () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    const cleanup = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };

    child.on("error", (err: NodeJS.ErrnoException) => {
      cleanup();
      if (err.code === "ENOENT") {
        reject(
          new UserInputError(text`
            Could not find "${command}" on your PATH. Install it and make sure it is runnable,
            then try again.
          `),
        );
      } else {
        reject(err);
      }
    });

    child.on("exit", (code, signal) => {
      cleanup();
      if (code !== null) {
        resolve(code);
      } else if (signal !== null) {
        resolve(SIGNAL_EXIT[signal] ?? 1);
      } else {
        resolve(0);
      }
    });
  });
}

/** Preflight PATH check so we can show an install hint instead of a raw spawn failure. */
export async function isOnPath(command: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  return await new Promise<boolean>(resolve => {
    const child = spawn(probe, [command], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", code => resolve(code === 0));
  });
}
