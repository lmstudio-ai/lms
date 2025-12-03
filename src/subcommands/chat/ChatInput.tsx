import { Box, useInput, useStdin } from "ink";
import { type ChatUserInputState } from "./types.js";
import { type Dispatch, type SetStateAction } from "react";
import {
  deleteCharacterBeforeCursor,
  insertTextAtCursor,
  moveCursorLeft,
  moveCursorRight,
  removeCurrentLargePasteSegment,
  splitLargePasteSegmentAtCursor,
} from "./chatInputStateReducers.js";
import { useBufferedPasteDetection } from "./hooks.js";
import { renderInputLine } from "./chatInputRendering.js";

interface ChatInputProps {
  inputState: ChatUserInputState;
  isPredicting: boolean;
  isConfirmReloadActive: boolean;
  areSuggestionsVisible: boolean;
  setUserInputState: Dispatch<SetStateAction<ChatUserInputState>>;
  onSubmit: () => void;
  onAbortPrediction: () => void;
  onExit: () => void;
  onSuggestionsUp: () => void;
  onSuggestionsDown: () => void;
  onSuggestionsPageLeft: () => void;
  onSuggestionsPageRight: () => void;
  onSuggestionAccept: () => void;
  onPaste: (content: string) => void;
}

export const ChatInput = ({
  inputState,
  isPredicting,
  isConfirmReloadActive,
  areSuggestionsVisible,
  setUserInputState,
  onSubmit,
  onAbortPrediction,
  onExit,
  onSuggestionsUp,
  onSuggestionsDown,
  onSuggestionsPageLeft,
  onSuggestionsPageRight,
  onSuggestionAccept,
  onPaste,
}: ChatInputProps) => {
  const segmentInWhichCursorIsLocated = inputState.segments[inputState.cursorOnSegmentIndex];
  const { stdin } = useStdin();
  const skipUseInputRef = useBufferedPasteDetection({ stdin, onPaste });

  useInput((inputCharacter, key) => {
    if (skipUseInputRef.current === true) {
      return;
    }

    if (key.ctrl === true && inputCharacter === "c") {
      if (isPredicting) {
        onAbortPrediction();
      } else {
        onExit();
      }
      return;
    }

    if (isPredicting) {
      return;
    }

    if (areSuggestionsVisible) {
      if (key.upArrow === true) {
        onSuggestionsUp();
        return;
      }
      if (key.downArrow === true) {
        onSuggestionsDown();
        return;
      }
      if (key.leftArrow === true) {
        onSuggestionsPageLeft();
        return;
      }
      if (key.rightArrow === true) {
        onSuggestionsPageRight();
        return;
      }
      if (key.tab === true) {
        onSuggestionAccept();
        return;
      }
    }

    if (key.backspace === true || key.delete === true) {
      if (segmentInWhichCursorIsLocated.type === "largePaste") {
        setUserInputState(previousState => removeCurrentLargePasteSegment(previousState));
      } else {
        setUserInputState(previousState => deleteCharacterBeforeCursor(previousState));
      }
      return;
    }

    if (key.leftArrow === true && areSuggestionsVisible === false) {
      setUserInputState(previousState => moveCursorLeft(previousState));
      return;
    }

    if (key.rightArrow === true && areSuggestionsVisible === false) {
      setUserInputState(previousState => moveCursorRight(previousState));
      return;
    }

    if (key.return === true && key.shift === true) {
      if (segmentInWhichCursorIsLocated.type === "largePaste") {
        setUserInputState(previousState => splitLargePasteSegmentAtCursor(previousState));
      }
    }

    if (key.return === true) {
      onSubmit();
      return;
    }

    if (
      key.ctrl !== true &&
      key.meta !== true &&
      inputCharacter !== undefined &&
      inputCharacter.length > 0
    ) {
      const normalizedInputChunk = inputCharacter.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      if (normalizedInputChunk.length === 0) {
        return;
      }

      setUserInputState(previousState =>
        insertTextAtCursor({ state: previousState, text: normalizedInputChunk }),
      );
    }
  });

  let fullText = "";
  let cursorPosition = 0;
  const pasteRanges: Array<{ start: number; end: number }> = [];

  for (let index = 0; index < inputState.segments.length; index++) {
    const segment = inputState.segments[index];

    if (segment.type === "largePaste") {
      const placeholder = `[Pasted ${segment.content.length} characters]`;
      const startPos = fullText.length;

      if (index < inputState.cursorOnSegmentIndex) {
        cursorPosition += placeholder.length;
      } else if (index === inputState.cursorOnSegmentIndex) {
        cursorPosition += inputState.cursorInSegmentOffset === 0 ? 0 : placeholder.length;
      }

      fullText += placeholder;
      pasteRanges.push({ start: startPos, end: fullText.length });
    } else {
      if (index < inputState.cursorOnSegmentIndex) {
        cursorPosition += segment.content.length;
      } else if (index === inputState.cursorOnSegmentIndex) {
        cursorPosition += inputState.cursorInSegmentOffset;
      }

      fullText += segment.content;
    }
  }

  const inputLines = fullText.split("\n");

  return (
    <Box flexWrap="wrap" flexDirection="column" width={"100%"}>
      {inputLines.map((lineText, lineIndex) =>
        renderInputLine({
          lineText,
          lineIndex,
          fullText,
          cursorPosition,
          pasteRanges,
          isConfirmReloadActive,
        }),
      )}
    </Box>
  );
};
