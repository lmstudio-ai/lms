import type { Dispatch, SetStateAction } from "react";

import { insertImageAtCursor, insertPasteAtCursor } from "../inputReducer.js";
import type { ChatUserInputState } from "../types.js";
import { readDroppedImageFileAsBase64 } from "./images.js";
import { extractDroppedFilePaths } from "./paths.js";

export async function handlePasteOrDrop({
  normalizedContent,
  setUserInputState,
  largePasteThreshold,
  logErrorInChat,
}: {
  normalizedContent: string;
  setUserInputState: Dispatch<SetStateAction<ChatUserInputState>>;
  largePasteThreshold: number;
  logErrorInChat: (message: string) => void;
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
    try {
      const image = await readDroppedImageFileAsBase64(filePath);
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
        nextState = insertImageAtCursor({
          state: nextState,
          image: {
            source: "base64",
            fileName: image.fileName,
            contentBase64: image.base64,
            mime: image.mimeType,
            name: image.fileName,
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

