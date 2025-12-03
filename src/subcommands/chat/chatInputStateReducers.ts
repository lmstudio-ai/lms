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

interface MoveCursorToPreviousSegmentOpts {
  state: ChatUserInputState;
  startIndex: number;
  skipLargePastesWhenPossible: boolean;
}

interface MoveCursorToNextSegmentOpts {
  state: ChatUserInputState;
  startIndex: number;
  skipLargePastesWhenPossible: boolean;
}

type ChatUserInputStateMutator = (draft: ChatUserInputState) => void;

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

function moveCursorToPreviousSegment({
  state,
  startIndex,
  skipLargePastesWhenPossible,
}: MoveCursorToPreviousSegmentOpts): void {
  if (startIndex < 0) {
    return;
  }
  let fallbackLargePasteIndex: number | undefined;
  for (let segmentIndex = startIndex; segmentIndex >= 0; segmentIndex -= 1) {
    const segment = state.segments[segmentIndex];
    if (segment === undefined) {
      continue;
    }
    if (segment.type === "largePaste") {
      if (fallbackLargePasteIndex === undefined) {
        fallbackLargePasteIndex = segmentIndex;
      }
      if (skipLargePastesWhenPossible === true) {
        continue;
      }
      state.cursorOnSegmentIndex = segmentIndex;
      state.cursorInSegmentOffset = 0;
      return;
    }
    state.cursorOnSegmentIndex = segmentIndex;
    state.cursorInSegmentOffset = segment.content.length;
    return;
  }
  if (fallbackLargePasteIndex !== undefined) {
    state.cursorOnSegmentIndex = fallbackLargePasteIndex;
    state.cursorInSegmentOffset = 0;
  }
}

function moveCursorToNextSegment({
  state,
  startIndex,
  skipLargePastesWhenPossible,
}: MoveCursorToNextSegmentOpts): void {
  if (startIndex >= state.segments.length) {
    return;
  }
  let fallbackLargePasteIndex: number | undefined;
  for (let segmentIndex = startIndex; segmentIndex < state.segments.length; segmentIndex += 1) {
    const segment = state.segments[segmentIndex];
    if (segment === undefined) {
      continue;
    }
    if (segment.type === "largePaste") {
      if (fallbackLargePasteIndex === undefined) {
        fallbackLargePasteIndex = segmentIndex;
      }
      if (skipLargePastesWhenPossible === true) {
        continue;
      }
      state.cursorOnSegmentIndex = segmentIndex;
      state.cursorInSegmentOffset = 1;
      return;
    }
    state.cursorOnSegmentIndex = segmentIndex;
    state.cursorInSegmentOffset = 0;
    return;
  }
  if (fallbackLargePasteIndex !== undefined) {
    state.cursorOnSegmentIndex = fallbackLargePasteIndex;
    state.cursorInSegmentOffset = 1;
  }
}

function sanitizeChatUserInputState(state: ChatUserInputState): void {
  if (state.segments.length === 0) {
    state.segments.push({ type: "text", content: "" });
    state.cursorOnSegmentIndex = 0;
    state.cursorInSegmentOffset = 0;
    return;
  }
  for (let segmentIndex = state.segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
    const segment = state.segments[segmentIndex];
    if (segment === undefined || segment.type !== "text" || segment.content.length !== 0) {
      continue;
    }
    const isCursorOnSegment = state.cursorOnSegmentIndex === segmentIndex;
    const isLastSegment = segmentIndex === state.segments.length - 1;
    const previousSegment = state.segments[segmentIndex - 1];
    const isTrailingPlaceholder = isLastSegment === true && previousSegment?.type === "largePaste";
    if (isTrailingPlaceholder === true) {
      console.log("Skipping removal of trailing placeholder segment");
      continue;
    }
    if (isCursorOnSegment === true && segmentIndex > 0) {
      state.segments.splice(segmentIndex, 1);
      continue;
    }
    state.segments.splice(segmentIndex, 1);
    if (state.cursorOnSegmentIndex > segmentIndex) {
      state.cursorOnSegmentIndex -= 1;
    } else if (state.cursorOnSegmentIndex === segmentIndex) {
      state.cursorOnSegmentIndex = Math.max(0, segmentIndex - 1);
      state.cursorInSegmentOffset = 0;
    }
  }
  if (state.segments.length === 0) {
    state.segments.push({ type: "text", content: "" });
    state.cursorOnSegmentIndex = 0;
    state.cursorInSegmentOffset = 0;
    return;
  }
  const lastIndex = state.segments.length - 1;
  const lastSegment = state.segments[lastIndex];
  if (lastSegment !== undefined && lastSegment.type === "largePaste") {
    state.segments.push({ type: "text", content: "" });
    if (state.cursorOnSegmentIndex === lastIndex) {
      state.cursorOnSegmentIndex = lastIndex + 1;
      state.cursorInSegmentOffset = 0;
    }
  }
  if (state.cursorOnSegmentIndex >= state.segments.length) {
    state.cursorOnSegmentIndex = state.segments.length - 1;
    state.cursorInSegmentOffset = 0;
  }
  if (state.cursorOnSegmentIndex < 0) {
    state.cursorOnSegmentIndex = 0;
    state.cursorInSegmentOffset = 0;
  }
  const activeSegment = state.segments[state.cursorOnSegmentIndex];
  if (activeSegment === undefined) {
    state.cursorOnSegmentIndex = 0;
    state.cursorInSegmentOffset = 0;
    return;
  }
  if (activeSegment.type === "text") {
    if (state.cursorInSegmentOffset < 0) {
      state.cursorInSegmentOffset = 0;
    }
    if (state.cursorInSegmentOffset > activeSegment.content.length) {
      state.cursorInSegmentOffset = activeSegment.content.length;
    }
  } else if (state.cursorInSegmentOffset < 0) {
    state.cursorInSegmentOffset = 0;
  }
}

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
    draft.cursorOnSegmentIndex = Math.min(draft.cursorOnSegmentIndex, draft.segments.length - 1);
    draft.cursorInSegmentOffset = 0;
  });
}

export function deleteCharacterBeforeCursor(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined || currentSegment.type !== "text") {
      return;
    }
    const cursorPosition = draft.cursorInSegmentOffset;
    if (cursorPosition === 0) {
      if (draft.cursorOnSegmentIndex === 0) {
        return;
      }
      const previousSegmentIndex = draft.cursorOnSegmentIndex - 1;
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
      const newCursorOffset = previousSegment.content.length - 1;
      previousSegment.content = previousSegment.content.slice(0, -1) + currentSegment.content;
      draft.segments.splice(draft.cursorOnSegmentIndex, 1);
      draft.cursorOnSegmentIndex = previousSegmentIndex;
      draft.cursorInSegmentOffset = newCursorOffset;
      return;
    }
    currentSegment.content =
      currentSegment.content.slice(0, cursorPosition - 1) +
      currentSegment.content.slice(cursorPosition);
    draft.cursorInSegmentOffset = cursorPosition - 1;
  });
}

export function moveCursorLeft(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    if (currentSegment.type === "largePaste") {
      if (draft.cursorOnSegmentIndex === 0) {
        return;
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
      draft.cursorOnSegmentIndex = previousSegmentIndex;
      draft.cursorInSegmentOffset = previousSegment.content.length;
      return;
    }
    const cursorPosition = draft.cursorInSegmentOffset;
    if (cursorPosition === 0) {
      const shouldSkipLargeSegments =
        currentSegment.type === "text" && currentSegment.content.length > 0;
      moveCursorToPreviousSegment({
        state: draft,
        startIndex: draft.cursorOnSegmentIndex - 1,
        skipLargePastesWhenPossible: shouldSkipLargeSegments,
      });
      return;
    }
    draft.cursorInSegmentOffset = cursorPosition - 1;
  });
}

export function moveCursorRight(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    if (currentSegment.type === "largePaste") {
      const nextSegmentIndex = draft.cursorOnSegmentIndex + 1;
      if (nextSegmentIndex >= draft.segments.length) {
        return;
      }
      const nextSegment = draft.segments[nextSegmentIndex];
      if (nextSegment === undefined) {
        return;
      }
      if (nextSegment.type === "largePaste") {
        draft.segments.splice(nextSegmentIndex, 0);
        draft.cursorOnSegmentIndex = nextSegmentIndex;
        draft.cursorInSegmentOffset = 0;
        return;
      }
      draft.cursorOnSegmentIndex = nextSegmentIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }
    const cursorPosition = draft.cursorInSegmentOffset;
    const segmentLength = currentSegment.content.length;
    if (cursorPosition >= segmentLength) {
      const shouldSkipLargeSegments = segmentLength > 0;
      moveCursorToNextSegment({
        state: draft,
        startIndex: draft.cursorOnSegmentIndex + 1,
        skipLargePastesWhenPossible: shouldSkipLargeSegments,
      });
      return;
    }
    draft.cursorInSegmentOffset = cursorPosition + 1;
  });
}

export function splitLargePasteSegmentAtCursor(state: ChatUserInputState): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined || currentSegment.type !== "largePaste") {
      return;
    }
    const largePasteIndex = draft.cursorOnSegmentIndex;
    if (draft.cursorInSegmentOffset === 0) {
      draft.segments.splice(largePasteIndex, 0, { type: "text", content: "" });
      draft.cursorOnSegmentIndex = largePasteIndex;
      draft.cursorInSegmentOffset = 0;
      return;
    }
    draft.segments.splice(largePasteIndex + 1, 0, { type: "text", content: "" });
    draft.cursorOnSegmentIndex = largePasteIndex + 1;
    draft.cursorInSegmentOffset = 0;
  });
}

export function insertTextAtCursor({ state, text }: InsertTextAtCursorOpts): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    if (currentSegment.type === "largePaste") {
      const largePasteIndex = draft.cursorOnSegmentIndex;
      if (draft.cursorInSegmentOffset === 0) {
        draft.segments.splice(largePasteIndex, 0, { type: "text", content: text });
        draft.cursorOnSegmentIndex = largePasteIndex;
      } else {
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
      const cursorPosition = draft.cursorInSegmentOffset;
      currentSegment.content =
        currentSegment.content.slice(0, cursorPosition) +
        text +
        currentSegment.content.slice(cursorPosition);
      draft.cursorInSegmentOffset = cursorPosition + text.length;
    }
  });
}

export function insertPasteAtCursor({
  state,
  content,
  largePasteThreshold,
}: InsertPasteAtCursorOpts): ChatUserInputState {
  return produceSanitizedState(state, draft => {
    if (content.length === 0) {
      return;
    }
    const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
    if (currentSegment === undefined) {
      return;
    }
    const isLargePaste = content.length >= largePasteThreshold;
    if (currentSegment.type === "largePaste") {
      const largePasteIndex = draft.cursorOnSegmentIndex;
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
      const textBeforeCursor = currentSegment.content.slice(0, cursorPosition);
      currentSegment.content = textBeforeCursor;
      draft.segments.splice(draft.cursorOnSegmentIndex + 1, 0, { type: "largePaste", content });
      return;
    }
    currentSegment.content =
      currentSegment.content.slice(0, cursorPosition) +
      content +
      currentSegment.content.slice(cursorPosition);
    draft.cursorInSegmentOffset = cursorPosition + content.length;
  });
}
