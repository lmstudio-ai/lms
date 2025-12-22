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
  // Handle empty state
  if (state.segments.length === 0) {
    return {
      segmentIndex: 0,
      offset: 0,
    };
  }

  const cursorSegmentIndex = state.cursorOnSegmentIndex;
  const cursorOffset = state.cursorInSegmentOffset;

  // Validate cursor position
  if (cursorSegmentIndex < 0 || cursorSegmentIndex >= state.segments.length) {
    return {
      segmentIndex: 0,
      offset: 0,
    };
  }

  const currentSegment = state.segments[cursorSegmentIndex];

  // Check current segment for newline before cursor
  if (currentSegment !== undefined && currentSegment.type === "text") {
    const textBeforeCursor = currentSegment.content.slice(0, cursorOffset);
    const lastNewlineInCurrentSegment = textBeforeCursor.lastIndexOf("\n");

    // Found newline in current segment - line starts after it
    if (lastNewlineInCurrentSegment !== -1) {
      return {
        segmentIndex: cursorSegmentIndex,
        offset: lastNewlineInCurrentSegment + 1,
      };
    }
  }

  // Search backward through previous segments for newline
  for (let segmentIndex = cursorSegmentIndex - 1; segmentIndex >= 0; segmentIndex -= 1) {
    const segment = state.segments[segmentIndex];

    // Skip non-text segments (e.g., largePaste)
    if (segment === undefined || segment.type !== "text") {
      continue;
    }

    const lastNewlineInSegment = segment.content.lastIndexOf("\n");

    // Found newline in previous segment - line starts after it
    if (lastNewlineInSegment !== -1) {
      return {
        segmentIndex,
        offset: lastNewlineInSegment + 1,
      };
    }
  }

  // No newline found - line starts at beginning of input
  return {
    segmentIndex: 0,
    offset: 0,
  };
}

function findLineEndPosition(state: ChatUserInputState): CursorPosition {
  // Handle empty state
  if (state.segments.length === 0) {
    return {
      segmentIndex: 0,
      offset: 0,
    };
  }

  const cursorSegmentIndex = state.cursorOnSegmentIndex;
  const cursorOffset = state.cursorInSegmentOffset;

  // Validate cursor position
  if (cursorSegmentIndex < 0 || cursorSegmentIndex >= state.segments.length) {
    return {
      segmentIndex: 0,
      offset: 0,
    };
  }

  const currentSegment = state.segments[cursorSegmentIndex];

  // Check current segment for newline after cursor
  if (currentSegment !== undefined && currentSegment.type === "text") {
    const textAfterCursor = currentSegment.content.slice(cursorOffset);
    const newlineRelativeIndex = textAfterCursor.indexOf("\n");

    // Found newline in current segment - line ends at it
    if (newlineRelativeIndex !== -1) {
      const newlineAbsoluteIndex = cursorOffset + newlineRelativeIndex;

      return {
        segmentIndex: cursorSegmentIndex,
        offset: newlineAbsoluteIndex,
      };
    }
  }

  // Search forward through following segments for newline
  for (
    let segmentIndex = cursorSegmentIndex + 1;
    segmentIndex < state.segments.length;
    segmentIndex += 1
  ) {
    const segment = state.segments[segmentIndex];

    // Skip non-text segments (e.g., largePaste)
    if (segment === undefined || segment.type !== "text") {
      continue;
    }

    const newlineIndex = segment.content.indexOf("\n");

    // Found newline in following segment - line ends at it
    if (newlineIndex !== -1) {
      return {
        segmentIndex,
        offset: newlineIndex,
      };
    }
  }

  // No newline found - line ends at end of last text segment
  const lastSegmentIndex = state.segments.length - 1;
  const lastSegment = state.segments[lastSegmentIndex];

  // Can never be the case because we have our trailing placeholder rule
  // but we handle it anyway as this runs before sanitation
  if (lastSegment !== undefined && lastSegment.type === "text") {
    return {
      segmentIndex: lastSegmentIndex,
      offset: lastSegment.content.length,
    };
  }

  // Again, this can never be the case because of our trailing placeholder rule
  // but we handle it anyway as this runs before sanitation
  // Last segment is not text - search backward for last text segment
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

  // No text segments found - default to beginning
  return {
    segmentIndex: 0,
    offset: 0,
  };
}

function isWordSeparatorCharacter(character: string): boolean {
  if (/\s/.test(character) === true) {
    return true;
  }

  if (character === "-") {
    return true;
  }

  return false;
}

/**
 * Finds the previous word boundary in a text segment given a cursor offset.
 * The word boundary is defined as the position before the start of the word
 * that precedes the cursor offset.
 * @param content - The text content of the segment
 * @param cursorOffset - The cursor position within the segment
 * @returns The offset of the previous word boundary
 */
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

  // Scan backwards over any word separator characters
  while (scanIndex > 0) {
    const previousCharacter = content.charAt(scanIndex - 1);

    // If previous character is a word separator, keep moving left
    if (isWordSeparatorCharacter(previousCharacter) === true) {
      scanIndex -= 1;
    } else {
      // Found a non-separator character, stop scanning
      break;
    }
  }

  // Now scan backwards over non-separator characters to find the start of the word
  while (scanIndex > 0) {
    const previousCharacter = content.charAt(scanIndex - 1);

    // If previous character is not a word separator, keep moving left
    if (isWordSeparatorCharacter(previousCharacter) === false) {
      scanIndex -= 1;
    } else {
      // Found a separator character, stop scanning
      break;
    }
  }

  return scanIndex;
}

/**
 * Finds the next word boundary in a text segment given a cursor offset.
 * The word boundary is defined as the position after the end of the word
 * that follows the cursor offset.
 * @param content - The text content of the segment
 * @param cursorOffset - The cursor position within the segment
 * @returns The offset of the next word boundary
 */
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

  // Scan forwards over any word separator characters
  // to find the start of the next word
  while (scanIndex < segmentLength) {
    const character = content.charAt(scanIndex);

    // If character is a word separator, keep moving right
    if (isWordSeparatorCharacter(character) === true) {
      scanIndex += 1;
    } else {
      // Found a non-separator character, stop scanning
      break;
    }
  }

  // Now scan forwards over non-separator characters
  while (scanIndex < segmentLength) {
    const character = content.charAt(scanIndex);

    // If character is not a word separator, keep moving right
    if (isWordSeparatorCharacter(character) === false) {
      scanIndex += 1;
    } else {
      // Found a separator character, stop scanning
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

/**
 * Moves the cursor to the start of the current line.
 * Handles multi-segment inputs and newlines.
 * @returns Updated ChatUserInputState with cursor at line start
 */
export function moveCursorToLineStart(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const lineStartPosition = findLineStartPosition(draft);

    draft.cursorOnSegmentIndex = lineStartPosition.segmentIndex;
    draft.cursorInSegmentOffset = lineStartPosition.offset;
  });
}

/**
 * Moves the cursor to the end of the current line.
 * Handles multi-segment inputs and newlines.
 * @returns Updated ChatUserInputState with cursor at line end
 */
export function moveCursorToLineEnd(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const lineEndPosition = findLineEndPosition(draft);

    draft.cursorOnSegmentIndex = lineEndPosition.segmentIndex;
    draft.cursorInSegmentOffset = lineEndPosition.offset;
  });
}

/**
 * Moves the cursor one word to the left.
 * For text segments,
 * if inside text segment, finds the previous word boundary.
 * if at start of text segment, moves to the end of the previous text segment.
 * For largePaste segments, moves to the previous segment.
 */
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

      // Inside text segment
      if (cursorOffset > 0) {
        // Find previous word boundary within current segment and move cursor there
        const newCursorOffset = findPreviousWordBoundaryInSegment(segmentContent, cursorOffset);
        draft.cursorInSegmentOffset = newCursorOffset;
        return;
      }
    }

    // At the start of the current segment (text or largePaste) - move to previous segment
    const previousSegmentIndex = currentSegmentIndex - 1;
    const previousSegment = draft.segments[previousSegmentIndex];

    if (previousSegment === undefined) {
      return;
    }

    // If previous segment is largePaste, move cursor there
    if (previousSegment.type === "largePaste") {
      draft.cursorOnSegmentIndex = previousSegmentIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }

    // The previous segment is text - move to its end word boundary
    const previousContent = previousSegment.content;
    const newCursorOffset = findPreviousWordBoundaryInSegment(
      previousContent,
      previousContent.length,
    );

    draft.cursorOnSegmentIndex = previousSegmentIndex;
    draft.cursorInSegmentOffset = newCursorOffset;
  });
}

/**
 * Moves the cursor one word to the right.
 * For text segments,
 * if inside text segment, finds the next word boundary.
 * if at end of text segment, moves to the start of the next text segment.
 * For largePaste segments, moves to the next segment.
 */
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

      // Inside text segment
      if (cursorOffset < segmentLength) {
        // Find next word boundary within current segment and move cursor there
        const newCursorOffset = findNextWordBoundaryInSegment(segmentContent, cursorOffset);
        draft.cursorInSegmentOffset = newCursorOffset;
        return;
      }
    }

    // At the end of the current segment (text or largePaste) - move to next segment
    const nextSegmentIndex = currentSegmentIndex + 1;
    const nextSegment = draft.segments[nextSegmentIndex];

    if (nextSegment === undefined) {
      return;
    }

    // If next segment is largePaste, move cursor there
    if (nextSegment.type === "largePaste") {
      draft.cursorOnSegmentIndex = nextSegmentIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }

    // The next segment is text - move to its start word boundary
    const nextContent = nextSegment.content;
    const newCursorOffset = findNextWordBoundaryInSegment(nextContent, 0);

    draft.cursorOnSegmentIndex = nextSegmentIndex;
    draft.cursorInSegmentOffset = newCursorOffset;
  });
}

/**
 * Deletes the word before the cursor.
 * Handles all segment types and cursor positions:
 * - On text segment: deletes word before cursor
 * - On largePaste at offset 0: deletes the previous segment
 *
 */
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

      // Inside text segment
      if (cursorOffset > 0) {
        // Find previous word boundary within current segment
        const newCursorOffset = findPreviousWordBoundaryInSegment(segmentContent, cursorOffset);

        // We are at the start of a word - nothing to delete
        if (newCursorOffset === cursorOffset) {
          return;
        }

        // Delete content from newCursorOffset to cursorOffset
        currentSegment.content =
          segmentContent.slice(0, newCursorOffset) + segmentContent.slice(cursorOffset);
        draft.cursorInSegmentOffset = newCursorOffset;
        return;
      }
    }
    // At the start of the current segment (text or largePaste) - delete from previous segment
    const previousSegmentIndex = currentSegmentIndex - 1;
    const previousSegment = draft.segments[previousSegmentIndex];

    if (previousSegment === undefined) {
      return;
    }

    // Previous segment is largePaste - delete the entire segment
    if (previousSegment.type === "largePaste") {
      draft.segments.splice(previousSegmentIndex, 1);
      draft.cursorOnSegmentIndex = previousSegmentIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }

    // Previous segment is text - delete last word from it
    const previousContent = previousSegment.content;
    const previousLength = previousContent.length;

    // Find previous word boundary in previous text segment
    const newCursorOffset = findPreviousWordBoundaryInSegment(previousContent, previousLength);

    // Delete content from newCursorOffset to end of previous segment
    previousSegment.content = previousContent.slice(0, newCursorOffset);
    draft.cursorOnSegmentIndex = previousSegmentIndex;
    draft.cursorInSegmentOffset = newCursorOffset;
  });
}

/**
 * Deletes the word after the cursor.
 * Handles all segment types and cursor positions:
 * - On text segment: deletes word after cursor or the next large paste
 * - On largePaste at offset 0: deletes the paste segment
 */
export function deleteWordForward(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegmentIndex = draft.cursorOnSegmentIndex;
    const currentSegment = draft.segments[currentSegmentIndex];

    if (currentSegment === undefined) {
      return;
    }

    const currentSegmentType = currentSegment.type;
    switch (currentSegmentType) {
      case "text": {
        const segmentContent = currentSegment.content;
        const cursorOffset = draft.cursorInSegmentOffset;
        const segmentLength = segmentContent.length;

        // Inside text segment
        if (cursorOffset < segmentLength) {
          // Find next word boundary within current segment and delete up to there
          const newCursorOffset = findNextWordBoundaryInSegment(segmentContent, cursorOffset);
          if (newCursorOffset === cursorOffset) {
            return;
          }

          // Delete content from cursorOffset to newCursorOffset
          currentSegment.content =
            segmentContent.slice(0, cursorOffset) + segmentContent.slice(newCursorOffset);
          return;
        }

        // At end of text segment - delete next segment
        const nextSegmentIndex = currentSegmentIndex + 1;
        const nextSegment = draft.segments[nextSegmentIndex];

        if (nextSegment === undefined) {
          return;
        }

        // If next segment is largePaste, delete it
        if (nextSegment.type === "largePaste") {
          draft.segments.splice(nextSegmentIndex, 1);
          return;
        }

        // Next segment is text - delete first word from it
        const nextContent = nextSegment.content;
        const nextWordBoundary = findNextWordBoundaryInSegment(nextContent, 0);

        // Delete content from start to nextWordBoundary in next segment
        nextSegment.content = nextContent.slice(nextWordBoundary);
        return;
      }
      case "largePaste": {
        const segmentIndexToRemove = currentSegmentIndex;
        draft.segments.splice(segmentIndexToRemove, 1);

        // We know for sure that there is at least one segment left after sanitation
        // due to the trailing placeholder rule so segmentIndexToRemove will be valid
        draft.cursorOnSegmentIndex = segmentIndexToRemove;
        draft.cursorInSegmentOffset = 0;
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
