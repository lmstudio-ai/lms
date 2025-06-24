import { spawn } from "child_process";

function getCommandForPlatform(): string {
  switch (process.platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer.exe";
    case "linux":
      return "xdg-open";
    default:
      throw new Error("Unsupported platform: " + process.platform);
  }
}

/**
 * Error handling is deliberately minimal, as this function is to be easy to use for shell scripting
 *
 * @param url The URL to open
 * @param callback A function with a single error argument. Optional.
 */

export function openUrl(url: string, callback?: (error: Error | null) => void) {
  const command = getCommandForPlatform();
  const child = spawn(command, [url]);
  let errorText = "";

  child.stderr.setEncoding("utf8");

  child.stderr.on("data", function (data) {
    errorText += data;
  });

  child.stderr.on("end", function () {
    if (errorText.length > 0) {
      const error = new Error(errorText);
      if (callback) {
        callback(error);
      } else {
        throw error;
      }
    } else if (callback) {
      callback(null);
    }
  });
}
