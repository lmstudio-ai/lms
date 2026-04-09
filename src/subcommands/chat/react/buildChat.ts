import {
  type ChatMessagePartFileData,
  type ChatMessagePartTextData,
  type FileHandle,
  type LMStudioClient,
} from "@lmstudio/sdk";
import type { ChatInputSegment } from "./types.js";
import type { ImageStore } from "./images/imageStore.js";
import { ImagePreparationError } from "./images/imageErrors.js";

export type UserMessagePart = ChatMessagePartTextData | ChatMessagePartFileData;

export async function buildUserMessageParts({
  client,
  inputSegments,
  imageStore,
}: {
  client: LMStudioClient;
  inputSegments: ChatInputSegment[];
  imageStore: ImageStore;
}): Promise<UserMessagePart[]> {
  let preparedImagesByHash = new Map<string, FileHandle>();
  try {
    preparedImagesByHash = await imageStore.prepareImagesForChat(client, inputSegments);
  } catch (error) {
    if (error instanceof ImagePreparationError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ImagePreparationError("prepare_failed", message);
  }

  const parts: UserMessagePart[] = [];
  for (const segment of inputSegments) {
    switch (segment.type) {
      case "text": {
        parts.push({ type: "text", text: segment.content });
        break;
      }
      case "chip": {
        switch (segment.data.kind) {
          case "largePaste": {
            parts.push({ type: "text", text: segment.data.content });
            break;
          }
          case "image": {
            const nextImage = preparedImagesByHash.get(segment.data.imageHash);
            if (nextImage === undefined) {
              throw new ImagePreparationError(
                "prepare_failed",
                `Missing prepared image for hash ${segment.data.imageHash}.`,
              );
            }
            parts.push({
              type: "file",
              name: nextImage.name,
              identifier: nextImage.identifier,
              sizeBytes: nextImage.sizeBytes,
              fileType: nextImage.type,
            });
            break;
          }
          default: {
            const exhaustiveCheck: never = segment.data;
            throw new Error(`Unhandled chip kind: ${JSON.stringify(exhaustiveCheck)}`);
          }
        }
        break;
      }
      default: {
        const exhaustiveCheck: never = segment;
        throw new Error(`Unhandled segment type: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }
  return parts;
}
