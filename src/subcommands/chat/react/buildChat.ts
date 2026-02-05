import {
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

  let preparedImages: Awaited<ReturnType<typeof client.files.prepareImage>>[] = [];
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
    if (segment.type === "text") {
      parts.push({ type: "text", text: segment.content });
      continue;
    }
    if (segment.data.kind === "largePaste") {
      parts.push({ type: "text", text: segment.data.content });
      continue;
    }
    // image chip
    const nextImage = preparedImages[preparedImageIndex];
    if (nextImage === undefined) {
      continue;
    }
    preparedImageIndex += 1;
    parts.push({
      type: "file",
      name: nextImage.name,
      identifier: nextImage.identifier,
      sizeBytes: nextImage.sizeBytes,
      fileType: nextImage.type,
    });
  }

  // Ensure there is at least a leading text part. This matches the append(role, content, opts)
  // behavior and avoids edge cases with image-only messages.
  if (parts.length === 0 || parts[0]?.type !== "text") {
    parts.unshift({ type: "text", text: "" });
  }

  return parts;
}
