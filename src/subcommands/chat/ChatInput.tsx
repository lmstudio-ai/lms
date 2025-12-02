import { Box, Text, useInput, useStdin } from "ink";
import { type ChatUserInputState } from "./types.js";
import { produce } from "@lmstudio/immer-with-plugins";
import { useEffect, useRef } from "react";

interface ChatInputProps {
  inputState: ChatUserInputState;
  isPredicting: boolean;
  isConfirmReloadActive: boolean;
  areSuggestionsVisible: boolean;
  setUserInputState: React.Dispatch<React.SetStateAction<ChatUserInputState>>;
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
  const skipUseInputRef = useRef(false);
  const pasteBufferRef = useRef("");
  const pasteTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Detect paste via stdin
  useEffect(() => {
    if (stdin === undefined) {
      return;
    }

    const handleData = (data: Buffer) => {
      const str = data.toString("utf8");

      // Exclude escape sequences (arrow keys, control sequences, etc.)
      const isEscapeSequence = str.startsWith("\x1b");

      if ((str.length > 1 || str.includes("\n")) && isEscapeSequence === false) {
        skipUseInputRef.current = true;
        pasteBufferRef.current += str;

        if (pasteTimeoutRef.current !== undefined) {
          clearTimeout(pasteTimeoutRef.current);
        }

        pasteTimeoutRef.current = setTimeout(() => {
          const normalizedContent = pasteBufferRef.current
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");
          if (normalizedContent.length > 0) {
            onPaste(normalizedContent);
          }
          pasteBufferRef.current = "";
          skipUseInputRef.current = false;
          pasteTimeoutRef.current = undefined;
        }, 100);
      }
    };

    stdin.on("data", handleData);

    return () => {
      stdin.off("data", handleData);
      if (pasteTimeoutRef.current !== undefined) {
        clearTimeout(pasteTimeoutRef.current);
      }
    };
  }, [stdin, onPaste]);

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
        setUserInputState(
          produce(draft => {
            draft.segments.splice(draft.cursorOnSegmentIndex, 1);
            draft.cursorOnSegmentIndex = Math.min(
              draft.cursorOnSegmentIndex,
              draft.segments.length - 1,
            );
            draft.cursorInSegmentOffset = 0;
          }),
        );
      } else {
        setUserInputState(
          produce(draft => {
            const cursorPosition = draft.cursorInSegmentOffset;
            if (cursorPosition === 0) {
              if (draft.cursorOnSegmentIndex === 0) {
                return;
              }
              const previousSegmentIndex = draft.cursorOnSegmentIndex - 1;
              const previousSegment = draft.segments[previousSegmentIndex];

              if (previousSegment.type === "largePaste") {
                draft.segments.splice(previousSegmentIndex, 1);
                draft.cursorOnSegmentIndex = previousSegmentIndex;
                draft.cursorInSegmentOffset = 0;
              } else {
                const currentSegment = draft.segments[draft.cursorOnSegmentIndex];
                const newCursorOffset = previousSegment.content.length - 1;
                previousSegment.content =
                  previousSegment.content.slice(0, -1) + currentSegment.content;
                draft.segments.splice(draft.cursorOnSegmentIndex, 1);
                draft.cursorOnSegmentIndex = previousSegmentIndex;
                draft.cursorInSegmentOffset = newCursorOffset;
              }
              return;
            }
            const segment = draft.segments[draft.cursorOnSegmentIndex];
            segment.content =
              segment.content.slice(0, cursorPosition - 1) + segment.content.slice(cursorPosition);
            draft.cursorInSegmentOffset = cursorPosition - 1;
          }),
        );
      }
      return;
    }

    if (key.leftArrow === true && areSuggestionsVisible === false) {
      if (segmentInWhichCursorIsLocated.type === "largePaste") {
        setUserInputState(
          produce(draft => {
            if (draft.cursorOnSegmentIndex === 0) {
              return;
            }
            const previousSegmentIndex = draft.cursorOnSegmentIndex - 1;
            const previousSegment = draft.segments[previousSegmentIndex];
            draft.cursorOnSegmentIndex = previousSegmentIndex;
            if (previousSegment.type === "largePaste") {
              draft.cursorInSegmentOffset = 0;
            } else {
              draft.cursorInSegmentOffset = previousSegment.content.length;
            }
          }),
        );
      } else if (segmentInWhichCursorIsLocated.type === "text") {
        setUserInputState(
          produce(draft => {
            const cursorPosition = draft.cursorInSegmentOffset;
            if (cursorPosition === 0) {
              if (draft.cursorOnSegmentIndex === 0) {
                return;
              }
              const previousSegmentIndex = draft.cursorOnSegmentIndex - 1;
              const previousSegment = draft.segments[previousSegmentIndex];
              draft.cursorOnSegmentIndex = previousSegmentIndex;
              if (previousSegment.type === "largePaste") {
                draft.cursorInSegmentOffset = 0;
              } else {
                draft.cursorInSegmentOffset = previousSegment.content.length;
              }
              return;
            }
            draft.cursorInSegmentOffset = cursorPosition - 1;
          }),
        );
      }
      return;
    }

    if (key.rightArrow === true && areSuggestionsVisible === false) {
      if (segmentInWhichCursorIsLocated.type === "largePaste") {
        setUserInputState(
          produce(draft => {
            const nextSegmentIndex = draft.cursorOnSegmentIndex + 1;
            if (nextSegmentIndex >= draft.segments.length) {
              return;
            }
            draft.cursorOnSegmentIndex = nextSegmentIndex;
            draft.cursorInSegmentOffset = 0;
          }),
        );
      } else if (segmentInWhichCursorIsLocated.type === "text") {
        setUserInputState(
          produce(draft => {
            const cursorPosition = draft.cursorInSegmentOffset;
            const segmentLength = segmentInWhichCursorIsLocated.content.length;
            if (cursorPosition >= segmentLength) {
              const nextSegmentIndex = draft.cursorOnSegmentIndex + 1;
              if (nextSegmentIndex >= draft.segments.length) {
                return;
              }
              const nextSegment = draft.segments[nextSegmentIndex];
              draft.cursorOnSegmentIndex = nextSegmentIndex;
              draft.cursorInSegmentOffset = nextSegment.type === "largePaste" ? 1 : 0;
              return;
            }
            draft.cursorInSegmentOffset = cursorPosition + 1;
          }),
        );
      }
      return;
    }

    if (key.return === true && key.shift === true) {
      if (segmentInWhichCursorIsLocated.type === "largePaste") {
        setUserInputState(
          produce(draft => {
            const largePasteIndex = draft.cursorOnSegmentIndex;
            if (draft.cursorInSegmentOffset === 0) {
              draft.segments.splice(largePasteIndex, 0, { type: "text", content: "" });
              draft.cursorOnSegmentIndex = largePasteIndex;
              draft.cursorInSegmentOffset = 0;
            } else {
              draft.segments.splice(largePasteIndex + 1, 0, { type: "text", content: "" });
              draft.cursorOnSegmentIndex = largePasteIndex + 1;
              draft.cursorInSegmentOffset = 0;
            }
          }),
        );
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

      setUserInputState(
        produce(draft => {
          const segment = draft.segments[draft.cursorOnSegmentIndex];
          if (segment.type === "largePaste") {
            const largePasteIndex = draft.cursorOnSegmentIndex;
            if (draft.cursorInSegmentOffset === 0) {
              draft.segments.splice(largePasteIndex, 0, {
                type: "text",
                content: normalizedInputChunk,
              });
              draft.cursorOnSegmentIndex = largePasteIndex;
              draft.cursorInSegmentOffset = normalizedInputChunk.length;
            } else {
              draft.segments.splice(largePasteIndex + 1, 0, {
                type: "text",
                content: normalizedInputChunk,
              });
              draft.cursorOnSegmentIndex = largePasteIndex + 1;
              draft.cursorInSegmentOffset = normalizedInputChunk.length;
            }
          } else if (segment.type === "text") {
            const cursorPosition = draft.cursorInSegmentOffset;
            segment.content =
              segment.content.slice(0, cursorPosition) +
              normalizedInputChunk +
              segment.content.slice(cursorPosition);
            draft.cursorInSegmentOffset = cursorPosition + normalizedInputChunk.length;
          }
        }),
      );
    }
  });

  const renderInputLine = (
    lineText: string,
    lineIndex: number,
    terminalWidth: number,
    fullText: string,
    cursorPosition: number,
    pasteRanges: Array<{ start: number; end: number }>,
  ) => {
    const inputBeforeCursor = fullText.slice(0, cursorPosition);
    const cursorLineIndex =
      inputBeforeCursor.length === 0 ? 0 : inputBeforeCursor.split("\n").length - 1;
    const lastNewlineIndex = inputBeforeCursor.lastIndexOf("\n");
    const cursorColumnIndex =
      lastNewlineIndex === -1
        ? inputBeforeCursor.length
        : inputBeforeCursor.length - lastNewlineIndex - 1;

    const isCursorLine = lineIndex === cursorLineIndex;
    const shouldShowConfirmReloadPrefix = isConfirmReloadActive === true && lineIndex === 0;
    const promptPrefix = lineIndex === 0 ? "› " : "  ";
    const confirmReloadPrefix = shouldShowConfirmReloadPrefix === true ? "(yes/no) " : "";
    const visiblePrefixLength = (confirmReloadPrefix + promptPrefix).length;

    if (!isCursorLine) {
      const lineContentLength = lineText.length;
      const paddingLength = Math.max(0, terminalWidth - visiblePrefixLength - lineContentLength);
      const padding = " ".repeat(paddingLength);

      const lineStartPos =
        fullText.split("\n").slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0);
      const textParts = renderTextWithPasteColor(lineText, lineStartPos, pasteRanges);

      return (
        <Box key={lineIndex}>
          {shouldShowConfirmReloadPrefix === true && <Text color="cyan">(yes/no) </Text>}
          <Text color="cyan">{promptPrefix}</Text>
          {textParts}
          <Text>{padding}</Text>
        </Box>
      );
    }

    const hasCharacterAtCursor =
      cursorPosition < fullText.length && cursorColumnIndex < lineText.length;
    const cursorCharacter = hasCharacterAtCursor ? lineText[cursorColumnIndex] : " ";
    const beforeCursorText = lineText.slice(0, cursorColumnIndex);
    const afterCursorText =
      hasCharacterAtCursor && cursorColumnIndex + 1 <= lineText.length
        ? lineText.slice(cursorColumnIndex + 1)
        : "";
    const lineContentLength = beforeCursorText.length + 1 + afterCursorText.length;
    const paddingLength = Math.max(0, terminalWidth - visiblePrefixLength - lineContentLength);
    const padding = " ".repeat(paddingLength);

    const lineStartPos =
      fullText.split("\n").slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0);
    const beforeParts = renderTextWithPasteColor(beforeCursorText, lineStartPos, pasteRanges);
    const afterParts = renderTextWithPasteColor(
      afterCursorText,
      lineStartPos + cursorColumnIndex + 1,
      pasteRanges,
    );

    return (
      <Box key={lineIndex}>
        {shouldShowConfirmReloadPrefix === true && <Text color="cyan">(yes/no) </Text>}
        <Text color="cyan">{promptPrefix}</Text>
        {beforeParts}
        <Text inverse>{cursorCharacter}</Text>
        {afterParts}
        <Text>{padding}</Text>
      </Box>
    );
  };

  const renderTextWithPasteColor = (
    text: string,
    startPos: number,
    pasteRanges: Array<{ start: number; end: number }>,
  ) => {
    if (text.length === 0) {
      return null;
    }

    const parts: JSX.Element[] = [];
    let currentPos = 0;

    while (currentPos < text.length) {
      const absolutePos = startPos + currentPos;
      const inPaste = pasteRanges.find(
        range => absolutePos >= range.start && absolutePos < range.end,
      );

      if (inPaste !== undefined) {
        const relativeEnd = Math.min(inPaste.end - startPos, text.length);
        const pasteText = text.slice(currentPos, relativeEnd);
        parts.push(
          <Text key={currentPos} color="blue">
            {pasteText}
          </Text>,
        );
        currentPos = relativeEnd;
      } else {
        const nextPaste = pasteRanges.find(range => range.start > absolutePos);
        const endPos =
          nextPaste !== undefined ? Math.min(nextPaste.start - startPos, text.length) : text.length;
        const normalText = text.slice(currentPos, endPos);
        parts.push(<Text key={currentPos}>{normalText}</Text>);
        currentPos = endPos;
      }
    }

    return parts;
  };

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
  const terminalWidth = process.stdout.columns ?? 80;

  return (
    <Box flexDirection="column">
      {inputLines.map((lineText, lineIndex) =>
        renderInputLine(lineText, lineIndex, terminalWidth, fullText, cursorPosition, pasteRanges),
      )}
    </Box>
  );
};
