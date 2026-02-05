import { execFile } from "child_process";
import { promisify } from "util";
import { detectImageViaMagic } from "./util.js";

const execFileAsync = promisify(execFile);

export type ClipboardErrorLogger = (message: string) => void;

export type ClipboardImage = {
  base64: string;
  mimeType: string;
  fileName: string;
};

export async function readClipboardImageAsBase64(opts?: {
  onError?: ClipboardErrorLogger;
}): Promise<ClipboardImage | null> {
  if (process.platform !== "linux") {
    return null;
  }

  // Try Wayland first
  try {
    const { stdout } = await execFileAsync("wl-paste", ["-t", "image/png"], {
      encoding: "buffer",
      maxBuffer: 128 * 1024 * 1024,
    });

    if (stdout.length > 0) {
      const detected = detectImageViaMagic(stdout);
      if (detected !== null) {
        return {
          base64: stdout.toString("base64"),
          mimeType: detected.mimeType,
          fileName: `clipboard.${detected.extension}`,
        };
      }
    }
  } catch {
    // wl-paste not available or failed, try X11
  }

  // Try X11 (xclip)
  try {
    const { stdout } = await execFileAsync(
      "xclip",
      ["-selection", "clipboard", "-t", "image/png", "-o"],
      {
        encoding: "buffer",
        maxBuffer: 128 * 1024 * 1024,
      },
    );

    if (stdout.length > 0) {
      const detected = detectImageViaMagic(stdout);
      if (detected !== null) {
        return {
          base64: stdout.toString("base64"),
          mimeType: detected.mimeType,
          fileName: `clipboard.${detected.extension}`,
        };
      }
    }

    opts?.onError?.(
      "No image found in the clipboard. Copy an image, then try again.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const notFound =
      message.toLowerCase().includes("enoent") ||
      message.toLowerCase().includes("not found");
    if (notFound) {
      opts?.onError?.(
        "Clipboard image paste failed. Install `wl-clipboard` (Wayland) or `xclip` (X11), then try again.",
      );
      return null;
    }

    opts?.onError?.(`Clipboard image paste failed: ${message}`);
  }

  return null;
}
