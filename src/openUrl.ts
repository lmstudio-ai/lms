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
      return "open";
  }
}

export async function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
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
        reject(error);
      } else {
        resolve();
      }
    });

    child.on("error", error => {
      reject(error);
    });
  });
}
