import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { detectImageViaMagic } from "./detect.js";

export type DroppedImage = {
  fileName: string;
  base64: string;
  mimeType: string;
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export async function readDroppedImageFileAsBase64(filePath: string): Promise<DroppedImage | null> {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch {
    return null;
  }
  if (stat.isFile() === false) return null;
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (${stat.size} bytes).`);
  }

  const content = await fs.readFile(filePath);
  const detected = detectImageViaMagic(content);
  if (detected === null) return null;

  return {
    fileName: path.basename(filePath),
    base64: content.toString("base64"),
    mimeType: detected.mimeType,
  };
}

export function isExistingFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveExistingFilePath(filePath: string): string | null {
  if (isExistingFile(filePath)) return filePath;

  const candidates = new Set<string>();
  if (/[\u202f\u00a0]/.test(filePath)) {
    candidates.add(filePath.replace(/[\u202f\u00a0]/g, " "));
  }
  if (filePath.includes(" ")) {
    candidates.add(filePath.replace(/ /g, "\u202f"));
    candidates.add(filePath.replace(/ /g, "\u00a0"));
  }

  for (const candidate of candidates) {
    if (isExistingFile(candidate)) return candidate;
  }

  return null;
}
