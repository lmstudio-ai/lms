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
 * We do not throw error if in largePaste segment cursorInSegmentOffset > 0, instead
 * we sanitize it back to 0.
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

interface CursorPosition {
  segmentIndex: number;
  offset: number;
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
    mutator(draft);
    sanitizeChatUserInputState(draft);
  });
}

function findLineStartPosition(state: ChatUserInputState): CursorPosition {
  if (state.segments.length === 0) {
    return {
      segmentIndex: 0,
      offset: 0,
    };
  }

  const cursorSegmentIndex = state.cursorOnSegmentIndex;
  const cursorOffset = state.cursorInSegmentOffset;

  if (cursorSegmentIndex < 0 || cursorSegmentIndex >= state.segments.length) {
    return {
      segmentIndex: 0,
      offset: 0,
    };
  }

  const currentSegment = state.segments[cursorSegmentIndex];

  if (currentSegment !== undefined && currentSegment.type === "text") {
    const textBeforeCursor = currentSegment.content.slice(0, cursorOffset);
    const lastNewlineInCurrentSegment = textBeforeCursor.lastIndexOf("\n");

    if (lastNewlineInCurrentSegment !== -1) {
      return {
        segmentIndex: cursorSegmentIndex,
        offset: lastNewlineInCurrentSegment + 1,
      };
    }
  }

  for (let segmentIndex = cursorSegmentIndex - 1; segmentIndex >= 0; segmentIndex -= 1) {
    const segment = state.segments[segmentIndex];

    if (segment === undefined || segment.type !== "text") {
      continue;
    }

    const lastNewlineInSegment = segment.content.lastIndexOf("\n");

    if (lastNewlineInSegment !== -1) {
      return {
        segmentIndex,
        offset: lastNewlineInSegment + 1,
      };
    }
  }

  return {
    segmentIndex: 0,
    offset: 0,
  };
}

function findLineEndPosition(state: ChatUserInputState): CursorPosition {
  if (state.segments.length === 0) {
    return {
      segmentIndex: 0,
      offset: 0,
    };
  }

  const cursorSegmentIndex = state.cursorOnSegmentIndex;
  const cursorOffset = state.cursorInSegmentOffset;

  if (cursorSegmentIndex < 0 || cursorSegmentIndex >= state.segments.length) {
    return {
      segmentIndex: 0,
      offset: 0,
    };
  }

  const currentSegment = state.segments[cursorSegmentIndex];

  if (currentSegment !== undefined && currentSegment.type === "text") {
    const textAfterCursor = currentSegment.content.slice(cursorOffset);
    const newlineRelativeIndex = textAfterCursor.indexOf("\n");

    if (newlineRelativeIndex !== -1) {
      const newlineAbsoluteIndex = cursorOffset + newlineRelativeIndex;

      return {
        segmentIndex: cursorSegmentIndex,
        offset: newlineAbsoluteIndex,
      };
    }
  }

  for (
    let segmentIndex = cursorSegmentIndex + 1;
    segmentIndex < state.segments.length;
    segmentIndex += 1
  ) {
    const segment = state.segments[segmentIndex];

    if (segment === undefined || segment.type !== "text") {
      continue;
    }

    const newlineIndex = segment.content.indexOf("\n");

    if (newlineIndex !== -1) {
      return {
        segmentIndex,
        offset: newlineIndex,
      };
    }
  }

  const lastSegmentIndex = state.segments.length - 1;
  const lastSegment = state.segments[lastSegmentIndex];

  if (lastSegment !== undefined && lastSegment.type === "text") {
    return {
      segmentIndex: lastSegmentIndex,
      offset: lastSegment.content.length,
    };
  }

  for (let segmentIndex = lastSegmentIndex - 1; segmentIndex >= 0; segmentIndex -= 1) {
    const segment = state.segments[segmentIndex];

    if (segment === undefined || segment.type !== "text") {
      continue;
    }

    return {
      segmentIndex,
      offset: segment.content.length,
    };
  }

  return {
    segmentIndex: 0,
    offset: 0,
  };
}

function isWhitespaceCharacter(character: string): boolean {
  return /\s/.test(character);
}

function findPreviousWordBoundaryInSegment(content: string, cursorOffset: number): number {
  if (cursorOffset <= 0) {
    return 0;
  }

  const segmentLength = content.length;

  if (segmentLength === 0) {
    return 0;
  }

  let scanIndex = cursorOffset;

  if (scanIndex > segmentLength) {
    scanIndex = segmentLength;
  }

  while (scanIndex > 0) {
    const previousCharacter = content.charAt(scanIndex - 1);

    if (isWhitespaceCharacter(previousCharacter) === true) {
      scanIndex -= 1;
    } else {
      break;
    }
  }

  while (scanIndex > 0) {
    const previousCharacter = content.charAt(scanIndex - 1);

    if (isWhitespaceCharacter(previousCharacter) === false) {
      scanIndex -= 1;
    } else {
      break;
    }
  }

  return scanIndex;
}

function findNextWordBoundaryInSegment(content: string, cursorOffset: number): number {
  const segmentLength = content.length;

  if (segmentLength === 0) {
    return 0;
  }

  let scanIndex = cursorOffset;

  if (scanIndex < 0) {
    scanIndex = 0;
  }

  if (scanIndex >= segmentLength) {
    return segmentLength;
  }

  while (scanIndex < segmentLength) {
    const character = content.charAt(scanIndex);

    if (isWhitespaceCharacter(character) === true) {
      scanIndex += 1;
    } else {
      break;
    }
  }

  while (scanIndex < segmentLength) {
    const character = content.charAt(scanIndex);

    if (isWhitespaceCharacter(character) === false) {
      scanIndex += 1;
    } else {
      break;
    }
  }

  return scanIndex;
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
  // Remove empty text segments, except "trailing placeholders"
  // A trailing placeholder is an empty text segment after a largePaste that allows typing
  for (let segmentIndex = state.segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
    const segment = state.segments[segmentIndex];
    // Skip non-text segments or non-empty text segments
    if (segment === undefined || segment.type !== "text" || segment.content.length !== 0) {
      continue;
    }
    const isLastSegment = segmentIndex === state.segments.length - 1;
    const previousSegment = state.segments[segmentIndex - 1];
    const isTrailingPlaceholder = isLastSegment === true && previousSegment?.type === "largePaste";
    // Keep trailing placeholders - they allow typing after largePaste segments
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
    // For largePaste segments, ensure it is always 0
    state.cursorInSegmentOffset = 0;
  }
}

/**
 * Deletes content before the cursor (backspace behavior).
 * Handles all segment types and cursor positions:
 * - On text segment: deletes character or merges with previous segment
 * - On largePaste at offset 0: deletes the previous segment
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
        // Previous is largePaste - delete the entire segment
        draft.segments.splice(previousSegmentIndex, 1);
        draft.cursorOnSegmentIndex = Math.max(0, previousSegmentIndex - 1);

        if (previousSegmentIndex > 0) {
          // Cursor moves to segment before the deleted largePaste
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

    if (currentSegment.type === "largePaste") {
      // Error: cursor should not be > 0 on largePaste segments
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
          // Next is largePaste - delete it entirely
          draft.segments.splice(nextSegmentIndex, 1);
          return;
        }
      }
      case "largePaste": {
        // Cursor should be at offset 0 on largePaste
        if (draft.cursorInSegmentOffset !== 0) {
          return;
        }

        // Delete the largePaste segment
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
        // Error: Not expected. Move to start of current largePaste
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

export function moveCursorToLineStart(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const lineStartPosition = findLineStartPosition(draft);

    draft.cursorOnSegmentIndex = lineStartPosition.segmentIndex;
    draft.cursorInSegmentOffset = lineStartPosition.offset;
  });
}

export function moveCursorToLineEnd(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const lineEndPosition = findLineEndPosition(draft);

    draft.cursorOnSegmentIndex = lineEndPosition.segmentIndex;
    draft.cursorInSegmentOffset = lineEndPosition.offset;
  });
}

export function moveCursorWordLeft(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegmentIndex = draft.cursorOnSegmentIndex;
    const currentSegment = draft.segments[currentSegmentIndex];

    if (currentSegment === undefined) {
      return;
    }

    if (currentSegment.type === "text") {
      const segmentContent = currentSegment.content;
      const cursorOffset = draft.cursorInSegmentOffset;

      if (cursorOffset > 0) {
        const newCursorOffset = findPreviousWordBoundaryInSegment(segmentContent, cursorOffset);

        draft.cursorInSegmentOffset = newCursorOffset;
        return;
      }

      const previousSegmentIndex = currentSegmentIndex - 1;
      const previousSegment = draft.segments[previousSegmentIndex];

      if (previousSegment === undefined) {
        return;
      }

      if (previousSegment.type === "largePaste") {
        draft.cursorOnSegmentIndex = previousSegmentIndex;
        draft.cursorInSegmentOffset = 0;
        return;
      }

      const previousContent = previousSegment.content;
      const newCursorOffset = findPreviousWordBoundaryInSegment(
        previousContent,
        previousContent.length,
      );

      draft.cursorOnSegmentIndex = previousSegmentIndex;
      draft.cursorInSegmentOffset = newCursorOffset;
      return;
    }

    const previousSegmentIndex = currentSegmentIndex - 1;
    const previousSegment = draft.segments[previousSegmentIndex];

    if (previousSegment === undefined) {
      return;
    }

    if (previousSegment.type === "largePaste") {
      draft.cursorOnSegmentIndex = previousSegmentIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }

    const previousContent = previousSegment.content;
    const newCursorOffset = findPreviousWordBoundaryInSegment(
      previousContent,
      previousContent.length,
    );

    draft.cursorOnSegmentIndex = previousSegmentIndex;
    draft.cursorInSegmentOffset = newCursorOffset;
  });
}

export function moveCursorWordRight(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegmentIndex = draft.cursorOnSegmentIndex;
    const currentSegment = draft.segments[currentSegmentIndex];

    if (currentSegment === undefined) {
      return;
    }

    if (currentSegment.type === "text") {
      const segmentContent = currentSegment.content;
      const cursorOffset = draft.cursorInSegmentOffset;
      const segmentLength = segmentContent.length;

      if (cursorOffset < segmentLength) {
        const newCursorOffset = findNextWordBoundaryInSegment(segmentContent, cursorOffset);

        draft.cursorInSegmentOffset = newCursorOffset;
        return;
      }

      const nextSegmentIndex = currentSegmentIndex + 1;
      const nextSegment = draft.segments[nextSegmentIndex];

      if (nextSegment === undefined) {
        return;
      }

      if (nextSegment.type === "largePaste") {
        draft.cursorOnSegmentIndex = nextSegmentIndex;
        draft.cursorInSegmentOffset = 0;
        return;
      }

      const nextContent = nextSegment.content;
      const newCursorOffset = findNextWordBoundaryInSegment(nextContent, 0);

      draft.cursorOnSegmentIndex = nextSegmentIndex;
      draft.cursorInSegmentOffset = newCursorOffset;
      return;
    }

    const nextSegmentIndex = currentSegmentIndex + 1;
    const nextSegment = draft.segments[nextSegmentIndex];

    if (nextSegment === undefined) {
      return;
    }

    if (nextSegment.type === "largePaste") {
      draft.cursorOnSegmentIndex = nextSegmentIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }

    const nextContent = nextSegment.content;
    const newCursorOffset = findNextWordBoundaryInSegment(nextContent, 0);

    draft.cursorOnSegmentIndex = nextSegmentIndex;
    draft.cursorInSegmentOffset = newCursorOffset;
  });
}

export function deleteWordBackward(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegmentIndex = draft.cursorOnSegmentIndex;
    const currentSegment = draft.segments[currentSegmentIndex];

    if (currentSegment === undefined) {
      return;
    }

    if (currentSegment.type === "text") {
      const segmentContent = currentSegment.content;
      const cursorOffset = draft.cursorInSegmentOffset;

      if (cursorOffset > 0) {
        const newCursorOffset = findPreviousWordBoundaryInSegment(segmentContent, cursorOffset);

        if (newCursorOffset === cursorOffset) {
          return;
        }

        currentSegment.content =
          segmentContent.slice(0, newCursorOffset) + segmentContent.slice(cursorOffset);
        draft.cursorInSegmentOffset = newCursorOffset;
        return;
      }

      const previousSegmentIndex = currentSegmentIndex - 1;
      const previousSegment = draft.segments[previousSegmentIndex];

      if (previousSegment === undefined) {
        return;
      }

      if (previousSegment.type === "largePaste") {
        draft.segments.splice(previousSegmentIndex, 1);
        draft.cursorOnSegmentIndex = previousSegmentIndex;
        draft.cursorInSegmentOffset = 0;
        return;
      }

      const previousContent = previousSegment.content;
      const previousLength = previousContent.length;

      if (previousLength === 0) {
        draft.segments.splice(previousSegmentIndex, 1);
        draft.cursorOnSegmentIndex = previousSegmentIndex;
        draft.cursorInSegmentOffset = 0;
        return;
      }

      const newCursorOffset = findPreviousWordBoundaryInSegment(previousContent, previousLength);

      previousSegment.content = previousContent.slice(0, newCursorOffset);
      draft.cursorOnSegmentIndex = previousSegmentIndex;
      draft.cursorInSegmentOffset = newCursorOffset;
      return;
    }

    const currentSegmentIndexForLargePaste = draft.cursorOnSegmentIndex;

    if (currentSegment.type === "largePaste") {
      const segmentIndexToRemove = currentSegmentIndexForLargePaste;

      draft.segments.splice(segmentIndexToRemove, 1);

      const newCursorSegmentIndex = Math.max(0, segmentIndexToRemove - 1);
      const newCursorSegment = draft.segments[newCursorSegmentIndex];

      draft.cursorOnSegmentIndex = newCursorSegmentIndex;
      if (newCursorSegment?.type === "text") {
        draft.cursorInSegmentOffset = newCursorSegment.content.length;
      } else {
        draft.cursorInSegmentOffset = 0;
      }
    }
  });
}

export function deleteWordForward(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegmentIndex = draft.cursorOnSegmentIndex;
    const currentSegment = draft.segments[currentSegmentIndex];

    if (currentSegment === undefined) {
      return;
    }

    if (currentSegment.type === "text") {
      const segmentContent = currentSegment.content;
      const cursorOffset = draft.cursorInSegmentOffset;
      const segmentLength = segmentContent.length;

      if (cursorOffset < segmentLength) {
        const newCursorOffset = findNextWordBoundaryInSegment(segmentContent, cursorOffset);

        if (newCursorOffset === cursorOffset) {
          return;
        }

        currentSegment.content =
          segmentContent.slice(0, cursorOffset) + segmentContent.slice(newCursorOffset);
        return;
      }

      const nextSegmentIndex = currentSegmentIndex + 1;
      const nextSegment = draft.segments[nextSegmentIndex];

      if (nextSegment === undefined) {
        return;
      }

      if (nextSegment.type === "largePaste") {
        draft.segments.splice(nextSegmentIndex, 1);
        return;
      }

      const nextContent = nextSegment.content;
      const deleteEndOffset = findNextWordBoundaryInSegment(nextContent, 0);

      if (deleteEndOffset === 0) {
        return;
      }

      nextSegment.content = nextContent.slice(deleteEndOffset);
      return;
    }

    if (currentSegment.type === "largePaste") {
      const segmentIndexToRemove = currentSegmentIndex;

      draft.segments.splice(segmentIndexToRemove, 1);

      if (segmentIndexToRemove >= draft.segments.length) {
        const newCursorSegmentIndex = draft.segments.length - 1;
        if (newCursorSegmentIndex < 0) {
          draft.cursorOnSegmentIndex = 0;
          draft.cursorInSegmentOffset = 0;
          return;
        }
        draft.cursorOnSegmentIndex = newCursorSegmentIndex;
        const newCursorSegment = draft.segments[newCursorSegmentIndex];
        if (newCursorSegment?.type === "text") {
          draft.cursorInSegmentOffset = newCursorSegment.content.length;
        } else {
          draft.cursorInSegmentOffset = 0;
        }
      } else {
        draft.cursorOnSegmentIndex = segmentIndexToRemove;
        const newCursorSegment = draft.segments[segmentIndexToRemove];
        if (newCursorSegment?.type === "text") {
          draft.cursorInSegmentOffset = 0;
        } else {
          draft.cursorInSegmentOffset = 0;
        }
      }
    }
  });
}

/**
 * Inserts text at the cursor position.
 * - In text segment: inserts text at cursor position
 * - At start of largePaste: appends to previous text segment or creates new text segment
 *  (there is no real "inside" for largePaste)
 */
export function insertTextAtCursor({ state, text }: InsertTextAtCursorOpts): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    if (currentSegment.type === "largePaste") {
      if (draft.cursorInSegmentOffset !== 0) {
        // Something is wrong - we can only insert text at offset 0 of largePaste
        return;
      }
      const largePasteIndex = draft.cursorOnSegmentIndex;
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
 *   - On largePaste at offset 0: inserts before the largePaste segment
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
      if (draft.cursorInSegmentOffset !== 0) {
        // Error: cursor should only be at offset 0 on largePaste segments
        return;
      }
      const largePasteIndex = draft.cursorOnSegmentIndex;
      // Insert before current largePaste
      draft.segments.splice(largePasteIndex, 0, {
        type: isLargePaste === true ? "largePaste" : "text",
        content,
      });
      draft.cursorOnSegmentIndex = largePasteIndex;
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
