// Clipboard helpers live in this folder so we can add per-OS implementations later.
// We currently support pasting images from the macOS, Windows, and Linux clipboards (best-effort).

export type { ClipboardErrorLogger, ClipboardImage } from "./macos.js";

import { readClipboardImageAsBase64 as readMacosClipboardImageAsBase64 } from "./macos.js";
import { readClipboardImageAsBase64 as readWindowsClipboardImageAsBase64 } from "./windows.js";
import { readClipboardImageAsBase64 as readLinuxClipboardImageAsBase64 } from "./linux.js";

export async function readClipboardImageAsBase64(opts?: {
  onError?: (message: string) => void;
}) {
  if (process.platform === "win32") {
    return readWindowsClipboardImageAsBase64(opts);
  }
  if (process.platform === "darwin") {
    return readMacosClipboardImageAsBase64(opts);
  }
  if (process.platform === "linux") {
    return readLinuxClipboardImageAsBase64(opts);
  }
  return null;
}

