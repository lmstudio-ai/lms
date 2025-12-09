import { Box, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useMemo } from "react";
import { renderInputWithCursor } from "./inputRenderer.js";
import {
  deleteBeforeCursor,
  insertTextAtCursor,
  moveCursorLeft,
  moveCursorRight,
} from "./inputReducer.js";
import { useBufferedPasteDetection } from "./hooks.js";
import { type ChatUserInputState } from "./types.js";

interface ChatInputProps {
  inputState: ChatUserInputState;
  isPredicting: boolean;
  isConfirmationActive: boolean;
  setUserInputState: Dispatch<SetStateAction<ChatUserInputState>>;
  onSubmit: () => void;
  onAbortPrediction: () => void;
  onExit: () => void;
;
  onPaste: (content: string) => void;
}

export const ChatInput = ({
  inputState,
  isPredicting,
  isConfirmationActive,
  setUserInputState,
  onSubmit,
  onAbortPrediction,
  onExit,
  onPaste,
}: ChatInputProps) => {
  const skipUseInputRef = useBufferedPasteDetection({ onPaste });

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



    if (key.backspace === true || key.delete === true) {
      setUserInputState(previousState => deleteBeforeCursor(previousState));
      return;
    }

    if (key.leftArrow === true ) {
      setUserInputState(previousState => moveCursorLeft(previousState));
      return;
    }

    if (key.rightArrow === true) {
      setUserInputState(previousState => moveCursorRight(previousState));
      return;
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

  const { fullText, cursorPosition, pasteRanges } = useMemo(() => {
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

    return { fullText, cursorPosition, pasteRanges };
  }, [inputState]);

  const lines = fullText.split("\n");
  const beforeCursor = fullText.slice(0, cursorPosition);
  const cursorLineIndex = beforeCursor.split("\n").length - 1;
  const lastNewlineBeforeCursor = beforeCursor.lastIndexOf("\n");
  const cursorColumnIndex =
    lastNewlineBeforeCursor === -1 ? cursorPosition : cursorPosition - lastNewlineBeforeCursor - 1;

  return (
    <Box flexDirection="column" width="100%" paddingTop={1}>
      {fullText.length === 0 && !isConfirmationActive ? (
        <Box>
          <Text color="cyan">› </Text>
          {isPredicting ? (
            <Text color="gray">Generating response...</Text>
          ) : (
            <>
              <Text inverse>T</Text>
              <Text>ype a message or use / to use commands</Text>
            </>
          )}
        </Box>
      ) : (
        lines.map((lineText, lineIndex) => {
          const lineStartPos =
            lines.slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0);
          const isCursorLine = lineIndex === cursorLineIndex;

          return (
            <Box key={lineIndex} flexWrap="wrap" width="100%">
              {lineIndex === 0 && isConfirmationActive && <Text color="cyan">(yes/no) </Text>}
              <Text color="cyan">{lineIndex === 0 ? "› " : "  "}</Text>
              {renderInputWithCursor({
                fullText: lineText,
                cursorPosition: isCursorLine ? cursorColumnIndex : -1,
                pasteRanges,
                lineStartPos,
              })}
            </Box>
          );
        })
      )}
    </Box>
  );
};
