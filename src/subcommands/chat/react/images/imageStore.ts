import { createHash } from "node:crypto";
import type { FileHandle, LMStudioClient } from "@lmstudio/sdk";
import type { ChatInputSegment } from "../types.js";
import { ImagePreparationError } from "./imageErrors.js";

type StoredImage = {
  contentBase64: string;
  mime?: string;
  fileName?: string;
};

export function hashImageBase64(contentBase64: string): string {
  return createHash("sha256").update(contentBase64).digest("hex");
}

/**
 * Shared image store for chat input images.
 *
 * - Keeps base64 blobs out of React state to reduce memory overhead.
 * - Dedupes identical images by hash and reuses prepared file handles.
 * - Uses a small LRU to avoid unbounded growth while still avoiding re-prepare churn.
 */
export class ImageStore {
  private readonly images = new Map<string, StoredImage>();
  private readonly preparedByHash = new Map<string, FileHandle>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = 35) {
    this.maxEntries = maxEntries;
  }

  storeImageBase64(contentBase64: string, mime?: string, fileName?: string): string {
    const hash = hashImageBase64(contentBase64);
    if (this.images.has(hash)) {
      const existing = this.images.get(hash);
      this.images.delete(hash);
      this.images.set(hash, existing ?? { contentBase64, mime, fileName });
      return hash;
    }
    this.images.set(hash, { contentBase64, mime, fileName });
    this.enforceLimit();
    return hash;
  }

  getImageBase64(hash: string): string | undefined {
    return this.images.get(hash)?.contentBase64;
  }

  deleteImages(hashes: Iterable<string>): void {
    for (const hash of hashes) {
      this.preparedByHash.delete(hash);
      this.images.delete(hash);
    }
  }

  private enforceLimit(): void {
    while (this.images.size > this.maxEntries) {
      const oldestHash = this.images.keys().next().value as string | undefined;
      if (oldestHash === undefined) {
        break;
      }
      this.images.delete(oldestHash);
      this.preparedByHash.delete(oldestHash);
    }
  }

  async prepareImagesForChat(
    client: LMStudioClient,
    segments: ChatInputSegment[],
  ): Promise<Map<string, FileHandle>> {
    const hashesToPrepare = new Map<string, { fileName: string }>();
    for (const segment of segments) {
      if (segment.type === "chip" && segment.data.kind === "image") {
        if (!this.preparedByHash.has(segment.data.imageHash)) {
          hashesToPrepare.set(segment.data.imageHash, { fileName: segment.data.fileName });
        }
      }
    }

    if (hashesToPrepare.size === 0) {
      return this.preparedByHash;
    }

    const preparedEntries = await Promise.all(
      [...hashesToPrepare.entries()].map(async ([hash, { fileName }]) => {
        const contentBase64 = this.getImageBase64(hash);
        if (contentBase64 === undefined) {
          throw new ImagePreparationError("prepare_failed", `Missing image data for hash ${hash}.`);
        }
        const prepared = await client.files.prepareImageBase64(fileName, contentBase64);
        const entry: [string, FileHandle] = [hash, prepared];
        return entry;
      }),
    );

    if (preparedEntries.some(([, prepared]) => prepared.type !== "image")) {
      throw new ImagePreparationError(
        "not_image",
        "clipboard content was not recognized as an image.",
      );
    }

    for (const [hash, prepared] of preparedEntries) {
      this.preparedByHash.set(hash, prepared);
    }

    return this.preparedByHash;
  }
}
