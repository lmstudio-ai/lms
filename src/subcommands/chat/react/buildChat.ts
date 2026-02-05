import {
  type FileHandle,
  type ChatMessagePartFileData,
  type ChatMessagePartTextData,
  type LMStudioClient,
} from "@lmstudio/sdk";
import type { ChatInputSegment } from "./types.js";

export type UserMessagePart = ChatMessagePartTextData | ChatMessagePartFileData;

export class ImagePreparationError extends Error {
  code: "not_image" | "prepare_failed";

  constructor(code: "not_image" | "prepare_failed", message: string) {
    super(message);
    this.code = code;
    this.name = "ImagePreparationError";
  }
}

export async function buildUserMessageParts({
  client,
  inputSegments,
}: {
  client: LMStudioClient;
  inputSegments: ChatInputSegment[];
}): Promise<UserMessagePart[]> {
  const imagesToPrepare = inputSegments.flatMap(segment => {
    if (segment.type !== "chip" || segment.data.kind !== "image") {
      return [];
    }
    return [segment.data];
  });

  let preparedImages: Awaited<Promise<FileHandle>>[] = [];
  try {
    preparedImages =
      imagesToPrepare.length > 0
        ? await Promise.all(
            imagesToPrepare.map(image => {
              return client.files.prepareImageBase64(image.fileName, image.contentBase64);
            }),
          )
        : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ImagePreparationError("prepare_failed", message);
  }

  if (preparedImages.some(image => image.type !== "image")) {
    throw new ImagePreparationError(
      "not_image",
      "clipboard content was not recognized as an image.",
    );
  }

  const parts: UserMessagePart[] = [];
  let preparedImageIndex = 0;
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
            const nextImage = preparedImages[preparedImageIndex];
            if (nextImage === undefined) {
              break;
            }
            preparedImageIndex += 1;
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
