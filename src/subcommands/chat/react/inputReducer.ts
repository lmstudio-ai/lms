/**
 * Input Reducer for Chat User Input State
 *
 * This module manages a multi-segment text input buffer that supports both regular text
 * and large paste segments (or chips). The buffer is designed to handle large pastes efficiently
 * by treating them as separate segments that can be removed/navigated independently.
 *
 * Segment Model:
 * - `text`: Regular text segments where the user can type. Cursor can be positioned
 *           anywhere within the text (0 to content.length).
 * - `largePaste`: Read-only paste segments for large content. Cursor can only be at
 *                 position 0 (start) and is typically used for navigation.
 *
 * There will be a trailing empty text segment after a largePaste to allow typing
 * after the paste.
 *
 * Cursor Semantics:
 * - `cursorOnSegmentIndex`: Which segment the cursor is currently on
 * - `cursorInSegmentOffset`: Position within that segment
 *   - For text segments: 0 to content.length (0 = before first char, length = after last char)
 *   - For largePaste segments: 0 = start, 1 = treated as "inside" for certain operations
 *
 * Sanitation:
 * After each mutation, the state is automatically sanitized to ensure:
 * - At least one segment always exists
 * - Empty text segments are removed (except trailing placeholders after largePaste)
 * - Cursor indices are within valid bounds
 */

import { produce } from "@lmstudio/immer-with-plugins";
import { type ChatUserInputState } from "./types.js";

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

type ChatUserInputStateMutator = (draft: ChatUserInputState) => void;

/**
 * Wrapper that applies a mutation to the state and automatically sanitizes it afterward.
 * Uses Immer to create an immutable update.
 */
function produceSanitizedState(
  state: ChatUserInputState,
  mutator: ChatUserInputStateMutator,
): ChatUserInputState {
  return produce(state, draft => {
    try {
      mutator(draft);
    } finally {
      sanitizeChatUserInputState(draft);
    }
  });
}

/**
 * Ensures the input state is valid by:
 * 1. Guaranteeing at least one segment exists
 * 2. Removing empty text segments (except trailing placeholders after largePaste)
 * 3. Clamping cursor indices to valid bounds
 * 4. Adjusting cursor offsets to valid ranges for each segment type
 * 5. Merging consecutive text segments to prevent navigation issues
 */
function sanitizeChatUserInputState(state: ChatUserInputState): void {
  // Ensure at least one segment exists
  if (state.segments.length === 0) {
    state.segments.push({ type: "text", content: "" });
    state.cursorOnSegmentIndex = 0;
    state.cursorInSegmentOffset = 0;
    return;
  }

  // Remove empty text segments, except "trailing placeholders"
  // A trailing placeholder is an empty text segment after a largePaste that allows typing
  for (let segmentIndex = state.segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
    const segment = state.segments[segmentIndex];
    // Skip non-text segments or non-empty text segments
    if (segment === undefined || segment.type !== "text" || segment.content.length !== 0) {
      continue;
    }
    const isCursorOnSegment = state.cursorOnSegmentIndex === segmentIndex;
    const isLastSegment = segmentIndex === state.segments.length - 1;
    const previousSegment = state.segments[segmentIndex - 1];
    const isTrailingPlaceholder = isLastSegment === true && previousSegment?.type === "largePaste";
    // Keep trailing placeholders - they allow typing after largePaste segments
    if (isTrailingPlaceholder === true) {
      continue;
    }
    // Remove this empty text segment
    if (isCursorOnSegment === true && segmentIndex > 0) {
      // Cursor is on this segment - just remove it and continue
      // The cursor adjustment logic below will handle repositioning
      state.segments.splice(segmentIndex, 1);
      continue;
    }
    state.segments.splice(segmentIndex, 1);
    // Adjust cursor indices after removal
    if (state.cursorOnSegmentIndex > segmentIndex) {
      state.cursorOnSegmentIndex -= 1;
    } else if (state.cursorOnSegmentIndex === segmentIndex) {
      state.cursorOnSegmentIndex = Math.max(0, segmentIndex - 1);
      state.cursorInSegmentOffset = 0;
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
  } else if (state.cursorInSegmentOffset < 0) {
    // For largePaste segments, ensure offset is non-negative
    state.cursorInSegmentOffset = 0;
  }
}

/**
 * Removes the current segment if it's a largePaste, then moves cursor to the next segment.
 * This is typically triggered by a user action.
 */
export function removeCurrentLargePasteSegment(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined || currentSegment.type !== "largePaste") {
      return;
    }
    draft.segments.splice(draft.cursorOnSegmentIndex, 1);
    if (draft.segments.length === 0) {
      draft.segments.push({ type: "text", content: "" });
      draft.cursorOnSegmentIndex = 0;
      draft.cursorInSegmentOffset = 0;
      return;
    }
    // Move cursor to the previous segment (backspace behavior)
    draft.cursorOnSegmentIndex = Math.max(0, draft.cursorOnSegmentIndex - 1);
    draft.cursorInSegmentOffset = 0;
  });
}

/**
 * Deletes content before the cursor (backspace behavior).
 * Handles all segment types and cursor positions:
 * - On text segment: deletes character or merges with previous segment
 * - On largePaste at offset 0: deletes the previous segment
 * - On largePaste at offset \> 0: deletes the current largePaste segment
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

    // On a largePaste segment
    if (currentSegment.type === "largePaste") {
      if (draft.cursorInSegmentOffset === 0) {
        // At start of largePaste - delete from previous segment
        if (draft.cursorOnSegmentIndex === 0) {
          return; // Already at start, nothing before
        }
        const previousSegmentIndex = draft.cursorOnSegmentIndex - 1;
        const previousSegment = draft.segments[previousSegmentIndex];
        if (previousSegment === undefined) {
          return;
        }
        if (previousSegment.type === "text") {
          // Delete last character from previous text segment
          if (previousSegment.content.length > 0) {
            previousSegment.content = previousSegment.content.slice(0, -1);
            draft.cursorOnSegmentIndex = previousSegmentIndex;
            draft.cursorInSegmentOffset = previousSegment.content.length;
            return;
          }
          // According to sanitation rules, empty text segments should not exist here,
          // but we safeguard against it anyway by deleting the empty segment
          draft.segments.splice(previousSegmentIndex, 1);
          draft.cursorOnSegmentIndex = Math.max(0, previousSegmentIndex - 1);
          draft.cursorInSegmentOffset = 0;
          return;
        } else {
          // Previous is largePaste - delete the entire segment
          draft.segments.splice(previousSegmentIndex, 1);
          draft.cursorOnSegmentIndex = previousSegmentIndex;
          draft.cursorInSegmentOffset = 0;
          return;
        }
      } else {
        // Inside largePaste (offset > 0) - delete the current largePaste
        draft.segments.splice(draft.cursorOnSegmentIndex, 1);
        if (draft.segments.length === 0) {
          draft.segments.push({ type: "text", content: "" });
          draft.cursorOnSegmentIndex = 0;
          draft.cursorInSegmentOffset = 0;
          return;
        }
        draft.cursorOnSegmentIndex = Math.max(0, draft.cursorOnSegmentIndex - 1);
        draft.cursorInSegmentOffset = 0;
        return;
      }
    }

    // On a text segment
    const cursorPosition = draft.cursorInSegmentOffset;
    if (cursorPosition === 0) {
      // At start of text segment - merge with or delete previous segment
      if (draft.cursorOnSegmentIndex === 0) {
        return; // Nothing before us
      }
      const previousSegmentIndex = draft.cursorOnSegmentIndex - 1;
      const previousSegment = draft.segments[previousSegmentIndex];
      if (previousSegment === undefined) {
        return;
      }
      if (previousSegment.type === "largePaste") {
        // Delete the entire largePaste segment
        draft.segments.splice(previousSegmentIndex, 1);
        draft.cursorOnSegmentIndex = previousSegmentIndex;
        draft.cursorInSegmentOffset = 0;
        return;
      }
      // Merge with previous text segment: delete last char from previous, append current
      const newCursorOffset = previousSegment.content.length - 1;
      previousSegment.content = previousSegment.content.slice(0, -1) + currentSegment.content;
      draft.segments.splice(draft.cursorOnSegmentIndex, 1);
      draft.cursorOnSegmentIndex = previousSegmentIndex;
      draft.cursorInSegmentOffset = newCursorOffset;
      return;
    }
    // Delete character before cursor within this text segment
    currentSegment.content =
      currentSegment.content.slice(0, cursorPosition - 1) +
      currentSegment.content.slice(cursorPosition);
    draft.cursorInSegmentOffset = cursorPosition - 1;
  });
}

/**
 * Moves the cursor one position to the left.
 * - Within text: moves one character left
 * - On largePaste: moves to start of current largePaste
 * - At start of anything: moves to previous segment
 */
export function moveCursorLeft(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    if (currentSegment.type === "largePaste") {
      if (draft.cursorOnSegmentIndex === 0) {
        return; // Already at first segment
      }
      if (draft.cursorInSegmentOffset > 0) {
        // Move to start of current largePaste
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
    if (previousSegment.type === "largePaste") {
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
 * - On largePaste: moves to the next segment (skipping over the largePaste)
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
    // At end of segment or on largePaste - move to next segment, handling largePast skips
    if (draft.cursorOnSegmentIndex >= draft.segments.length - 1) {
      return; // Already at last segment
    }
    const nextSegmentIndex = draft.cursorOnSegmentIndex + 1;
    const nextSegment = draft.segments[nextSegmentIndex];
    if (nextSegment === undefined) {
      return;
    }
    if (currentSegment.type === "largePaste") {
      // Move to next segment (whether it's text or largePaste)
      draft.cursorOnSegmentIndex = nextSegmentIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }
    if (nextSegment.type === "largePaste") {
      // Skip over largePaste to the segment after it
      const segmentAfterPaste = nextSegmentIndex + 1;
      if (segmentAfterPaste >= draft.segments.length) {
        return; // No segment after the largePaste
      }
      draft.cursorOnSegmentIndex = segmentAfterPaste;
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
 * - At start of largePaste: appends to previous text segment or creates new text segment
 * - Inside largePaste: creates new text segment after the largePaste as inside means index is 1
 *  (there is no real "inside" for largePaste, so we treat it as after the largePaste)
 */
export function insertTextAtCursor({ state, text }: InsertTextAtCursorOpts): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    if (currentSegment.type === "largePaste") {
      const largePasteIndex = draft.cursorOnSegmentIndex;
      if (draft.cursorInSegmentOffset === 0) {
        // At start of largePaste - try to append to previous text segment
        const previousSegment = draft.segments[largePasteIndex - 1];
        if (previousSegment !== undefined && previousSegment.type === "text") {
          previousSegment.content += text;
          draft.cursorOnSegmentIndex = largePasteIndex - 1;
          draft.cursorInSegmentOffset = previousSegment.content.length;
          return;
        }
        // No previous text segment - create a new one before the largePaste
        draft.segments.splice(largePasteIndex, 0, { type: "text", content: text });
        draft.cursorOnSegmentIndex = largePasteIndex;
      } else {
        // Inside largePaste - create new text segment after it
        draft.segments.splice(largePasteIndex + 1, 0, {
          type: "text",
          content: text,
        });
        draft.cursorOnSegmentIndex = largePasteIndex + 1;
      }
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
 * - Large paste: creates a largePaste segment with a trailing placeholder text segment
 *   - In text segment: splits the text, inserts largePaste, preserves text after cursor
 *   - On largePaste: inserts before or after based on cursor offset
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
    if (currentSegment.type === "largePaste") {
      // Inserting paste while on a largePaste segment
      const largePasteIndex = draft.cursorOnSegmentIndex;
      // Insert before current largePaste if at start, otherwise insert after
      const insertIndex = draft.cursorInSegmentOffset === 0 ? largePasteIndex : largePasteIndex + 1;
      draft.segments.splice(insertIndex, 0, {
        type: isLargePaste === true ? "largePaste" : "text",
        content,
      });
      draft.cursorOnSegmentIndex = insertIndex;
      draft.cursorInSegmentOffset = content.length;
      return;
    }
    if (currentSegment.type !== "text") {
      return;
    }
    const cursorPosition = draft.cursorInSegmentOffset;
    if (isLargePaste === true) {
      // Split current text segment to insert largePaste
      const textBeforeCursor = currentSegment.content.slice(0, cursorPosition);
      const textAfterCursor = currentSegment.content.slice(cursorPosition);
      currentSegment.content = textBeforeCursor;
      const insertIndex = draft.cursorOnSegmentIndex + 1;
      // Insert largePaste followed by trailing text segment (preserves text after cursor)
      draft.segments.splice(
        insertIndex,
        0,
        { type: "largePaste", content },
        {
          type: "text",
          content: textAfterCursor, // Empty string if no text after cursor
        },
      );
      // Place cursor in the trailing text segment after largePaste
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
 * Inserts a suggestion at the cursor position by replacing the last segment's content.
 * Used for autocomplete/suggestion acceptance (e.g., /model or /download suggestions).
 * - If last segment is text: replaces its content with suggestion
 * - If last segment is largePaste: appends a new text segment with suggestion
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
