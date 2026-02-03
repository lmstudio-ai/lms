import { execFile } from "child_process";
import { promises as fs } from "fs";
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
  if (process.platform !== "win32") {
    return null;
  }

  // Try to get file path from clipboard (when copied from File Explorer)
  const filePathScript =
    "Add-Type -AssemblyName System.Windows.Forms; $files = [System.Windows.Forms.Clipboard]::GetFileDropList(); if ($files -and $files.Count -gt 0) { $files[0] }";

  try {
    const { stdout: filePath } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NonInteractive", "-NoProfile", "-STA", "-Command", filePathScript],
      { encoding: "utf8" },
    );

    if (filePath?.trim()) {
      const cleanPath = filePath.trim();
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    opts?.onError?.(`Clipboard file paste failed: ${message}`);
  }

  // Try to get image data directly from clipboard (screenshots/browser copies)
  const imageScript =
    "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }";

  try {
    const { stdout: base64 } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NonInteractive", "-NoProfile", "-STA", "-Command", imageScript],
      { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
    );

    if (base64?.trim()) {
      const imageBuffer = Buffer.from(base64.trim(), "base64");
      if (imageBuffer.length > 0) {
        const detected = detectImageViaMagic(imageBuffer);
        if (detected === null) {
          return null;
        }
        return {
          base64: imageBuffer.toString("base64"),
          mimeType: detected.mimeType,
          fileName: `clipboard.${detected.extension}`,
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    opts?.onError?.(`Clipboard image paste failed: ${message}`);
  }

  return null;
}
