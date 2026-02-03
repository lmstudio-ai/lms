import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
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
  if (process.platform !== "darwin") {
    return null;
  }

  // Try to get file path from clipboard (when copied from Finder)
  try {
    const { stdout: filePath } = await execFileAsync("osascript", [
      "-e",
      "set fileList to (the clipboard as «class furl») as text",
    ]);

    if (filePath?.trim()) {
      // Convert HFS path to POSIX path
      const { stdout: posixPath } = await execFileAsync("osascript", [
        "-e",
        `POSIX path of "${filePath.trim()}"`,
      ]);

      if (posixPath?.trim()) {
        const cleanPath = posixPath.trim();
        const buffer = await fs.readFile(cleanPath);
        const detected = detectImageViaMagic(buffer);

        if (detected !== null) {
          return {
            base64: buffer.toString("base64"),
            mimeType: detected.mimeType,
            fileName: path.basename(cleanPath),
          };
        }
      }
    }
  } catch {
    // Not a file path or file doesn't exist, try direct image data
  }

  // Try to get image data directly from clipboard (screenshots, browser copies, etc.)
  try {
    // Check if clipboard contains image data before attempting extraction
    const { stdout } = await execFileAsync("osascript", ["-e", "clipboard info"]);
    if (!stdout.includes("PNGf") && !stdout.includes("TIFF")) {
      return null;
    }
  } catch {
    // No clipboard data available
    return null;
  }

  const tmpfile = path.join(tmpdir(), `clipboard-${Date.now()}.png`);

  try {
    const script = [
      'set imageData to the clipboard as "PNGf"',
      `set fileRef to open for access POSIX file "${tmpfile}" with write permission`,
      "set eof fileRef to 0",
      "write imageData to fileRef",
      "close access fileRef",
    ];

    await execFileAsync("osascript", [...script.flatMap(s => ["-e", s])]);

    const buffer = await fs.readFile(tmpfile);

    // Check if we actually got image data
    if (buffer.length === 0) {
      return null;
    }

    const detected = detectImageViaMagic(buffer);

    if (detected === null) {
      return null;
    }

    return {
      base64: buffer.toString("base64"),
      mimeType: detected.mimeType,
      fileName: `clipboard.${detected.extension}`,
    };
  } catch {
    return null;
  } finally {
    try {
      await fs.unlink(tmpfile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
