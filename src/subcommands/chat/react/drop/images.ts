import fs from "node:fs/promises";
import path from "node:path";

import { detectImageViaMagic } from "../clipboard/util.js";

export type DroppedImage = {
  fileName: string;
  base64: string;
  mimeType: string;
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export async function readDroppedImageFileAsBase64(filePath: string): Promise<DroppedImage | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
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

