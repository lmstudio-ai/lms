/**
 * Input Reducer for Chat User Input State
 *
 * This module manages a multi-segment text input buffer that supports both regular text
 * and chip segments. The buffer is designed to handle large pastes efficiently by treating them
 * as separate non-text segments that can be removed/navigated independently.
 *
 * Segment Model:
 * - `text`: Regular text segments where the user can type. Cursor can be positioned
 *           anywhere within the text (0 to content.length).
 * - `chip`: Read-only chip segments (e.g. largePaste, image). Cursor can only be at
 *           position 0 (start) and is typically used for navigation.
 *
 * We do not throw error if in chip segment cursorInSegmentOffset > 0, instead
 * we sanitize it back to 0.
 *
 * There will be a trailing empty text segment after a chip segment to allow typing after it.
 *
 * Cursor Semantics:
 * - `cursorOnSegmentIndex`: Which segment the cursor is currently on
 * - `cursorInSegmentOffset`: Position within that segment
 *   - For text segments: 0 to content.length (0 = before first char, length = after last char)
 *   - For chip segments: 0 = start
 *
 * Sanitation:
 * After each mutation, the state is automatically sanitized to ensure:
 * - At least one segment always exists
 * - Empty text segments are removed (except trailing placeholders after chip)
 * - Cursor indices are within valid bounds
 */

import { produce } from "@lmstudio/immer-with-plugins";
import { type ChatInputData, type ChatInputSegment, type ChatUserInputState } from "./types.js";

interface InsertTextAtCursorOpts {
  state: ChatUserInputState;
  text: string;
}

interface InsertPasteAtCursorOpts {
  state: ChatUserInputState;
  content: string;
  largePasteThreshold: number;
}

interface InsertSuggestionAtCursorOpts {
  state: ChatUserInputState;
  suggestionText: string;
}

interface InsertImageAtCursorOpts {
  state: ChatUserInputState;
  image: InsertableChatImageData;
}

type ChatUserInputStateMutator = (draft: ChatUserInputState) => void;

type ChatImageData = Extract<ChatInputData, { kind: "image" }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never;
type InsertableChatImageData = DistributiveOmit<ChatImageData, "kind">;

/**
 * Wrapper that applies a mutation to the state and automatically sanitizes it afterward.
 * Uses Immer to create an immutable update.
 */
function produceSanitizedState(
  state: ChatUserInputState,
  mutator: ChatUserInputStateMutator,
): ChatUserInputState {
  return produce(state, draft => {
    mutator(draft);
    sanitizeChatUserInputState(draft);
  });
}

/**
 * Ensures the input state is valid by:
 * 1. Guaranteeing at least one segment exists
 * 2. Removing empty text segments (except trailing placeholders after chip)
 * 3. Clamping cursor indices to valid bounds
 * 4. Adjusting cursor offsets to valid ranges for each segment type
 * 5. Merging consecutive text segments to prevent navigation issues
 */
function sanitizeChatUserInputState(state: ChatUserInputState): void {
  // Remove empty text segments, except "trailing placeholders"
  // A trailing placeholder is an empty text segment after a chip segment that allows typing
  for (let segmentIndex = state.segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
    const segment = state.segments[segmentIndex];
    // Skip non-text segments or non-empty text segments
    if (segment === undefined || segment.type !== "text" || segment.content.length !== 0) {
      continue;
    }
    const isLastSegment = segmentIndex === state.segments.length - 1;
    const previousSegment = state.segments[segmentIndex - 1];
    const isTrailingPlaceholder = isLastSegment === true && previousSegment?.type === "chip";
    // Keep trailing placeholders - they allow typing after chip segments
    if (isTrailingPlaceholder === true) {
      continue;
    }
    state.segments.splice(segmentIndex, 1);
    // Adjust cursor indices after removal
    if (state.cursorOnSegmentIndex > segmentIndex) {
      state.cursorOnSegmentIndex = state.cursorOnSegmentIndex - 1;
    } else if (state.cursorOnSegmentIndex === segmentIndex) {
      // Cursor was on the removed segment - move to previous segment
      // end or start as appropriate
      state.cursorOnSegmentIndex = Math.max(0, segmentIndex - 1);
      const newSegment = state.segments[state.cursorOnSegmentIndex];
      // If there is a segment there, adjust offset accordingly
      if (newSegment !== undefined) {
        // If new segment is text, place cursor at end except
        // if the first segment was removed
        if (newSegment.type === "text" && segmentIndex !== 0) {
          state.cursorInSegmentOffset = newSegment.content.length;
        } else if (segmentIndex === 0) {
          state.cursorInSegmentOffset = 0;
        } else {
          state.cursorOnSegmentIndex += 1;
          state.cursorInSegmentOffset = 0;
        }
      } else {
        state.cursorInSegmentOffset = 0;
      }
    }
  }

  // After cleanup, ensure at least one segment still exists
  if (state.segments.length === 0) {
    state.segments.push({ type: "text", content: "" });
    state.cursorOnSegmentIndex = 0;
    state.cursorInSegmentOffset = 0;
    return;
  }

  // Merge consecutive text segments so navigation does not get trapped between them
  let segmentIndex = 0;
  while (segmentIndex < state.segments.length - 1) {
    const currentSegment = state.segments[segmentIndex];
    const nextSegment = state.segments[segmentIndex + 1];
    if (currentSegment?.type !== "text" || nextSegment?.type !== "text") {
      segmentIndex += 1;
      continue;
    }
    const currentSegmentLength = currentSegment.content.length;
    const cursorWasOnNextSegment = state.cursorOnSegmentIndex === segmentIndex + 1;
    const cursorOffsetOnNextSegment = state.cursorInSegmentOffset;
    currentSegment.content += nextSegment.content;
    state.segments.splice(segmentIndex + 1, 1);
    if (cursorWasOnNextSegment === true) {
      state.cursorOnSegmentIndex = segmentIndex;
      state.cursorInSegmentOffset = currentSegmentLength + cursorOffsetOnNextSegment;
    } else if (state.cursorOnSegmentIndex > segmentIndex + 1) {
      state.cursorOnSegmentIndex -= 1;
    }
    // Re-check current segment in case another text segment follows it
  }

  // Clamp cursor segment index to valid bounds
  if (state.cursorOnSegmentIndex >= state.segments.length) {
    state.cursorOnSegmentIndex = state.segments.length - 1;
    state.cursorInSegmentOffset = 0;
  }
  if (state.cursorOnSegmentIndex < 0) {
    state.cursorOnSegmentIndex = 0;
    state.cursorInSegmentOffset = 0;
  }

  // Clamp cursor offset within the current segment
  const activeSegment = state.segments[state.cursorOnSegmentIndex];
  if (activeSegment === undefined) {
    state.cursorOnSegmentIndex = 0;
    state.cursorInSegmentOffset = 0;
    return;
  }
  if (activeSegment.type === "text") {
    // For text segments, offset can be 0 to content.length
    if (state.cursorInSegmentOffset < 0) {
      state.cursorInSegmentOffset = 0;
    }
    if (state.cursorInSegmentOffset > activeSegment.content.length) {
      state.cursorInSegmentOffset = activeSegment.content.length;
    }
  } else if (state.cursorInSegmentOffset < 0 || state.cursorInSegmentOffset > 0) {
    // For chip segments, ensure it is always 0
    state.cursorInSegmentOffset = 0;
  }
}

/**
 * Deletes content before the cursor (backspace behavior).
 * Handles all segment types and cursor positions:
 * - On text segment: deletes character or merges with previous segment
 * - On chip at offset 0: deletes the previous segment
 */
export function deleteBeforeCursor(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }

    // At the very start - nothing to delete
    if (draft.cursorOnSegmentIndex === 0 && draft.cursorInSegmentOffset === 0) {
      return;
    }

    // At start of any segment (offset === 0) - delete from previous segment
    if (draft.cursorInSegmentOffset === 0) {
      const previousSegmentIndex = draft.cursorOnSegmentIndex - 1;
      const previousSegment = draft.segments[previousSegmentIndex];
      if (previousSegment === undefined) {
        return;
      }

      if (previousSegment.type === "text") {
        // Delete last character from previous text segment
        if (previousSegment.content.length > 0) {
          const newCursorOffset = previousSegment.content.length - 1;
          previousSegment.content = previousSegment.content.slice(0, -1);

          // If current segment is text, merge it
          if (currentSegment.type === "text") {
            previousSegment.content += currentSegment.content;
            draft.segments.splice(draft.cursorOnSegmentIndex, 1);
          }

          draft.cursorOnSegmentIndex = previousSegmentIndex;
          draft.cursorInSegmentOffset = newCursorOffset;
          return;
        }
        // Empty text segment (shouldn't exist per sanitation rules)
        draft.segments.splice(previousSegmentIndex, 1);
        draft.cursorOnSegmentIndex = Math.max(0, previousSegmentIndex - 1);
        draft.cursorInSegmentOffset = 0;
        return;
      } else {
        // Previous is data - delete the entire segment
        draft.segments.splice(previousSegmentIndex, 1);
        draft.cursorOnSegmentIndex = Math.max(0, previousSegmentIndex - 1);

        if (previousSegmentIndex > 0) {
          // Cursor moves to segment before the deleted data
          const currentSegmentAfterDeletion = draft.segments[draft.cursorOnSegmentIndex];
          if (currentSegmentAfterDeletion?.type === "text") {
            draft.cursorInSegmentOffset = currentSegmentAfterDeletion.content.length;
          } else {
            draft.cursorInSegmentOffset = 0;
          }
        } else {
          // Cursor stays on same segment (shifted to index 0)
          draft.cursorInSegmentOffset = 0;
        }
        return;
      }
    }

    if (currentSegment.type === "chip") {
      // Error: cursor should not be > 0 on chip segments
      return;
    }

    // Delete character before cursor within text segment
    const cursorPosition = draft.cursorInSegmentOffset;
    currentSegment.content =
      currentSegment.content.slice(0, cursorPosition - 1) +
      currentSegment.content.slice(cursorPosition);
    draft.cursorInSegmentOffset = cursorPosition - 1;
  });
}

/**
 * Deletes the character after the cursor (Delete key behavior).
 * - Within text: deletes character at cursor position
 * - At end of text segment: merges with next segment or deletes it
 * - At end of input: does nothing
 */
export function deleteAfterCursor(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }

    const currentSegmentType = currentSegment.type;
    switch (currentSegmentType) {
      case "text": {
        const cursorOffset = draft.cursorInSegmentOffset;

        // Not at end of text segment - delete character at cursor
        if (cursorOffset < currentSegment.content.length) {
          currentSegment.content =
            currentSegment.content.slice(0, cursorOffset) +
            currentSegment.content.slice(cursorOffset + 1);
          return;
        }

        // At end of text segment - try to merge or delete next segment
        const nextSegmentIndex = draft.cursorOnSegmentIndex + 1;
        const nextSegment = draft.segments[nextSegmentIndex];

        if (nextSegment === undefined) {
          // At end of input - nothing to delete
          return;
        }

        if (nextSegment.type === "text") {
          // Delete first character of next text segment
          if (nextSegment.content.length > 0) {
            nextSegment.content = nextSegment.content.slice(1);
            return;
          }
          // Next segment is empty - remove it
          draft.segments.splice(nextSegmentIndex, 1);
          return;
        } else {
          // Next is data - delete it entirely
          draft.segments.splice(nextSegmentIndex, 1);
          return;
        }
      }
      case "chip": {
        // Cursor should be at offset 0 on chip
        if (draft.cursorInSegmentOffset !== 0) {
          return;
        }

        // Delete the chip segment
        draft.segments.splice(draft.cursorOnSegmentIndex, 1);

        if (draft.segments.length === 0) {
          // No segments left - will be handled by sanitization
          draft.cursorOnSegmentIndex = 0;
          draft.cursorInSegmentOffset = 0;
        }
        // Cursor stays at same index (which now points to trailing placeholder or next segment)
        break;
      }
      default: {
        const exhaustiveCheck: never = currentSegmentType;
        throw new Error(`Unhandled segment type: ${exhaustiveCheck}`);
      }
    }
  });
}

/**
 * Moves the cursor one position to the left.
 * - Within text: moves one character left
 * - On chip: moves to start of current chip
 * - At start of anything: moves to previous segment
 */
export function moveCursorLeft(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    if (currentSegment.type === "chip") {
      if (draft.cursorOnSegmentIndex === 0) {
        return; // Already at first segment
      }
      if (draft.cursorInSegmentOffset > 0) {
        // Error: Not expected. Move to start of current chip
        draft.cursorInSegmentOffset = 0;
        return;
      }
    } else {
      const cursorPosition = draft.cursorInSegmentOffset;
      if (cursorPosition > 0) {
        // Move one character left within text
        draft.cursorInSegmentOffset = cursorPosition - 1;
        return;
      }
    }
    // At start of segment - move to previous segment
    if (draft.cursorOnSegmentIndex === 0) {
      return; // Already at first segment
    }
    const previousSegmentIndex = draft.cursorOnSegmentIndex - 1;
    const previousSegment = draft.segments[previousSegmentIndex];
    if (previousSegment === undefined) {
      return;
    }
    if (previousSegment.type === "chip") {
      draft.cursorOnSegmentIndex = previousSegmentIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }
    const previousContentLength = previousSegment.content.length;
    draft.cursorOnSegmentIndex = previousSegmentIndex;
    draft.cursorInSegmentOffset = previousContentLength === 0 ? 0 : previousContentLength - 1;
  });
}

/**
 * Moves the cursor one position to the right.
 * - Within text: moves one character right
 * - At end of text: moves to next segment
 * - On chip: moves to the next segment (skipping over chips when moving from text)
 */
export function moveCursorRight(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    if (currentSegment.type === "text") {
      const cursorPosition = draft.cursorInSegmentOffset;
      const segmentLength = currentSegment.content.length;
      if (cursorPosition < segmentLength) {
        // Move one character right within text
        draft.cursorInSegmentOffset = cursorPosition + 1;
        return;
      }
    }
    // At end of segment or on chip - move to next segment, handling chip skips
    if (draft.cursorOnSegmentIndex >= draft.segments.length - 1) {
      return; // Already at last segment
    }
    const nextSegmentIndex = draft.cursorOnSegmentIndex + 1;
    const nextSegment = draft.segments[nextSegmentIndex];
    if (nextSegment === undefined) {
      return;
    }
    if (currentSegment.type === "chip") {
      // Move to next segment (whether it's text or chip)
      draft.cursorOnSegmentIndex = nextSegmentIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }
    if (nextSegment.type === "chip") {
      // Skip over chip to the segment after it
      const segmentAfterChip = nextSegmentIndex + 1;
      if (segmentAfterChip >= draft.segments.length) {
        return; // No segment after the chip
      }
      draft.cursorOnSegmentIndex = segmentAfterChip;
      draft.cursorInSegmentOffset = 0;
      return;
    }
    // Next segment is text - move to it
    draft.cursorOnSegmentIndex = nextSegmentIndex;
    draft.cursorInSegmentOffset = 0;
  });
}

/**
 * Inserts text at the cursor position.
 * - In text segment: inserts text at cursor position
 * - At start of chip: appends to previous text segment or creates new text segment
 *  (there is no real "inside" for chip)
 */
export function insertTextAtCursor({ state, text }: InsertTextAtCursorOpts): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    if (currentSegment.type === "chip") {
      if (draft.cursorInSegmentOffset !== 0) {
        // Something is wrong - we can only insert text at offset 0 of chip
        return;
      }
      const chipIndex = draft.cursorOnSegmentIndex;
      // At start of chip - try to append to previous text segment
      const previousSegment = draft.segments[chipIndex - 1];
      if (previousSegment !== undefined && previousSegment.type === "text") {
        previousSegment.content += text;
        draft.cursorOnSegmentIndex = chipIndex - 1;
        draft.cursorInSegmentOffset = previousSegment.content.length;
        return;
      }
      // No previous text segment - create a new one before the chip
      draft.segments.splice(chipIndex, 0, { type: "text", content: text });
      draft.cursorOnSegmentIndex = chipIndex;
      draft.cursorInSegmentOffset = text.length;
      return;
    }
    if (currentSegment.type === "text") {
      // Insert text at cursor position within text segment
      const cursorPosition = draft.cursorInSegmentOffset;
      currentSegment.content =
        currentSegment.content.slice(0, cursorPosition) +
        text +
        currentSegment.content.slice(cursorPosition);
      draft.cursorInSegmentOffset = cursorPosition + text.length;
    }
  });
}

/**
 * Inserts pasted content at the cursor position.
 * Content is treated as "large paste" if it exceeds largePasteThreshold.
 * - Small paste: inserted as regular text
 * - Large paste: creates a chip segment with a trailing placeholder text segment
 *   - In text segment: splits the text, inserts chip, preserves text after cursor
 *   - On chip at offset 0: inserts before the chip segment
 */
export function insertPasteAtCursor({
  state,
  content,
  largePasteThreshold,
}: InsertPasteAtCursorOpts): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    if (content.length === 0) {
      return; // Nothing to insert
    }
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    const isLargePaste = content.length >= largePasteThreshold;
    if (currentSegment.type === "chip") {
      // Inserting paste while on a chip segment
      if (draft.cursorInSegmentOffset !== 0) {
        // Error: cursor should only be at offset 0 on chip segments
        return;
      }
      const chipIndex = draft.cursorOnSegmentIndex;
      // Insert before current chip
      draft.segments.splice(
        chipIndex,
        0,
        isLargePaste === true
          ? { type: "chip", data: { kind: "largePaste", content } }
          : { type: "text", content },
      );
      draft.cursorOnSegmentIndex = chipIndex;
      draft.cursorInSegmentOffset = isLargePaste === true ? 0 : content.length;
      return;
    }
    if (currentSegment.type !== "text") {
      return;
    }
    const cursorPosition = draft.cursorInSegmentOffset;
    if (isLargePaste === true) {
      // Split current text segment to insert chip
      const textBeforeCursor = currentSegment.content.slice(0, cursorPosition);
      const textAfterCursor = currentSegment.content.slice(cursorPosition);
      currentSegment.content = textBeforeCursor;
      const insertIndex = draft.cursorOnSegmentIndex + 1;
      // Insert chip followed by trailing text segment (preserves text after cursor)
      draft.segments.splice(
        insertIndex,
        0,
        { type: "chip", data: { kind: "largePaste", content } },
        {
          type: "text",
          content: textAfterCursor, // Empty string if no text after cursor
        },
      );
      // Place cursor in the trailing text segment after chip
      draft.cursorOnSegmentIndex = insertIndex + 1;
      draft.cursorInSegmentOffset = 0;
      return;
    }
    // Small paste - insert as regular text
    currentSegment.content =
      currentSegment.content.slice(0, cursorPosition) +
      content +
      currentSegment.content.slice(cursorPosition);
    draft.cursorInSegmentOffset = cursorPosition + content.length;
  });
}

/**
 * Inserts an image chip at the cursor position.
 * - In text segment: splits the text, inserts image chip, preserves text after cursor
 * - On chip at offset 0: inserts before the chip
 *
 * Cursor is placed on the inserted chip (when inserting before an existing chip),
 * or on the trailing text segment (when inserting inside a text segment).
 */
export function insertImageAtCursor({ state, image }: InsertImageAtCursorOpts): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }

    const imageData: ChatImageData = { kind: "image", ...image };
    const chip: ChatInputSegment = { type: "chip", data: imageData };

    if (currentSegment.type === "chip") {
      if (draft.cursorInSegmentOffset !== 0) {
        return;
      }
      const chipIndex = draft.cursorOnSegmentIndex;
      draft.segments.splice(chipIndex, 0, chip);
      draft.cursorOnSegmentIndex = chipIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }

    const cursorPosition = draft.cursorInSegmentOffset;
    const textBeforeCursor = currentSegment.content.slice(0, cursorPosition);
    const textAfterCursor = currentSegment.content.slice(cursorPosition);
    currentSegment.content = textBeforeCursor;

    const insertIndex = draft.cursorOnSegmentIndex + 1;
    draft.segments.splice(insertIndex, 0, chip, { type: "text", content: textAfterCursor });
    draft.cursorOnSegmentIndex = insertIndex + 1;
    draft.cursorInSegmentOffset = 0;
  });
}

/**
 * Inserts a suggestion at the cursor position by replacing the last segment's content.
 * Used for autocomplete/suggestion acceptance (e.g., /model or /download suggestions).
 * - If last segment is text: replaces its content with suggestion
 * - If last segment is chip: appends a new text segment with suggestion
 * Cursor is placed at the end of the inserted suggestion.
 */
export function insertSuggestionAtCursor({
  state,
  suggestionText,
}: InsertSuggestionAtCursorOpts): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const lastSegmentIndex = draft.segments.length - 1;
    const lastSegment = draft.segments[lastSegmentIndex];
    if (lastSegment === undefined) {
      return;
    }
    if (lastSegment.type === "text") {
      lastSegment.content = suggestionText;
    } else {
      draft.segments.push({
        type: "text",
        content: suggestionText,
      });
    }
    draft.cursorOnSegmentIndex = draft.segments.length - 1;
    draft.cursorInSegmentOffset = suggestionText.length;
  });
}
