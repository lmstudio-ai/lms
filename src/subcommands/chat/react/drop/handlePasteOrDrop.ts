import type { Dispatch, SetStateAction } from "react";

import { insertImageAtCursor, insertPasteAtCursor } from "../inputReducer.js";
import type { ImageStore } from "../images/imageStore.js";
import type { ChatUserInputState } from "../types.js";
import { readDroppedImageFileAsBase64, resolveExistingFilePath } from "../images/util.js";
import { extractDroppedFilePaths } from "./paths.js";

export async function handlePasteOrDrop({
  normalizedContent,
  setUserInputState,
  largePasteThreshold,
  logErrorInChat,
  imageStore,
}: {
  normalizedContent: string;
  setUserInputState: Dispatch<SetStateAction<ChatUserInputState>>;
  largePasteThreshold: number;
  logErrorInChat: (message: string) => void;
  imageStore: ImageStore;
}): Promise<void> {
  const droppedFilePaths = extractDroppedFilePaths(normalizedContent);
  const looksLikeDrop =
    droppedFilePaths.length > 0 &&
    (normalizedContent.includes("file://") ||
      normalizedContent.includes("/") ||
      normalizedContent.includes("\\"));

  if (!looksLikeDrop) {
    setUserInputState(previousState =>
      insertPasteAtCursor({
        state: previousState,
        content: normalizedContent,
        largePasteThreshold,
      }),
    );
    return;
  }

  const imagesToInsert: Array<Awaited<ReturnType<typeof readDroppedImageFileAsBase64>>> = [];
  for (const filePath of droppedFilePaths) {
    const resolvedPath = resolveExistingFilePath(filePath);
    if (resolvedPath === null) {
      continue;
    }
    try {
      const image = await readDroppedImageFileAsBase64(resolvedPath);
      if (image !== null) {
        imagesToInsert.push(image);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logErrorInChat(`Failed to attach dropped image: ${message}`);
      return;
    }
  }

  if (imagesToInsert.length > 0) {
    setUserInputState(previousState => {
      let nextState = previousState;
      for (const image of imagesToInsert) {
        if (image === null) continue;
        const imageHash = imageStore.storeImageBase64(
          image.base64,
          image.mimeType,
          image.fileName,
        );
        nextState = insertImageAtCursor({
          state: nextState,
          image: {
            source: "base64",
            fileName: image.fileName,
            mime: image.mimeType,
            imageHash,
          },
        });
      }
      return nextState;
    });
    return;
  }

  // Not an image drop; treat as normal paste.
  setUserInputState(previousState =>
    insertPasteAtCursor({
      state: previousState,
      content: normalizedContent,
      largePasteThreshold,
    }),
  );
}
