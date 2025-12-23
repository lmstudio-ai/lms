import { Box, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useMemo } from "react";
import { useBufferedPasteDetection } from "./hooks.js";
import { InputPlaceholder } from "./InputPlaceholder.js";
import {
  deleteAfterCursor,
  deleteBeforeCursor,
  deleteToLineEnd,
  deleteToLineStart,
  deleteWordBackward,
  deleteWordForward,
  insertTextAtCursor,
  moveCursorLeft,
  moveCursorRight,
  moveCursorToLineEnd,
  moveCursorToLineStart,
  moveCursorWordLeft,
  moveCursorWordRight,
} from "./inputReducer.js";
import { renderInputWithCursor } from "./inputRenderer.js";
import { type ChatUserInputState } from "./types.js";

// Note: key.meta represents Command (⌘) on macOS and Alt on Windows/Linux
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

interface ChatInputProps {
  inputState: ChatUserInputState;
  isPredicting: boolean;
  isConfirmationActive: boolean;
  areSuggestionsVisible: boolean;
  modelLoadingProgress: number | null;
  promptProcessingProgress: number | null;
  fetchingModelDetails: { owner: string; name: string } | null;
  downloadProgress: { owner: string; name: string; progress: number } | null;
  setUserInputState: Dispatch<SetStateAction<ChatUserInputState>>;
  onSubmit: () => void;
  onAbortPrediction: () => void;
  onAbortDownload: () => void;
  onAbortModelLoading: () => void;
  onExit: () => void;
  onSuggestionsUp: () => void;
  onSuggestionsDown: () => void;
  onSuggestionsPageLeft: () => void;
  onSuggestionsPageRight: () => void;
  onSuggestionAccept: () => void;
  onPaste: (content: string) => void;
  commandHasSuggestions: (commandName: string) => boolean;
  selectedSuggestion?: { command: string; args: string[] } | null;
  predictionSpinnerVisible: boolean;
}

export const ChatInput = ({
  inputState,
  isPredicting,
  isConfirmationActive,
  areSuggestionsVisible,
  modelLoadingProgress,
  promptProcessingProgress,
  fetchingModelDetails,
  downloadProgress,
  setUserInputState,
  onSubmit,
  onAbortPrediction,
  onAbortDownload,
  onAbortModelLoading,
  onExit,
  onSuggestionsUp,
  onSuggestionsDown,
  onSuggestionsPageLeft,
  onSuggestionsPageRight,
  onSuggestionAccept,
  onPaste,
  commandHasSuggestions,
  selectedSuggestion,
  predictionSpinnerVisible,
}: ChatInputProps) => {
  const skipUseInputRef = useBufferedPasteDetection({ onPaste });
  const disableUserInput =
    (isPredicting ||
      modelLoadingProgress !== null ||
      downloadProgress !== null ||
      fetchingModelDetails !== null ||
      promptProcessingProgress !== null) &&
    isConfirmationActive === false;

  useInput((inputCharacter, key) => {
    if (skipUseInputRef.current === true) {
      return;
    }

    if (key.ctrl === true && inputCharacter === "c") {
      if (modelLoadingProgress !== null) {
        onAbortModelLoading();
      } else if (downloadProgress !== null) {
        onAbortDownload();
      } else if (isPredicting) {
        onAbortPrediction();
      } else {
        onExit();
      }
      return;
    }

    if (key.ctrl === true && inputCharacter === "d") {
      const isInputEmpty = inputState.segments.every(segment => segment.content.length === 0);
      if (isInputEmpty) {
        onExit();
        return;
      }
    }

    if (disableUserInput) {
      return;
    }

    if (key.ctrl === true) {
      // Also works as Ctrl+Backspace
      if (inputCharacter === "w") {
        setUserInputState(previousState => deleteWordBackward(previousState));
        return;
      }

      // Unix/Emacs-style shortcuts (not supported on Windows)
      if (isWindows === false) {
        // Also works as Cmd+LeftArrow on macOS
        if (inputCharacter === "a") {
          setUserInputState(previousState => moveCursorToLineStart(previousState));
          return;
        }

        // Also works as Cmd+RightArrow on macOS
        if (inputCharacter === "e") {
          setUserInputState(previousState => moveCursorToLineEnd(previousState));
          return;
        }

        if (inputCharacter === "f") {
          setUserInputState(previousState => moveCursorRight(previousState));
          return;
        }

        if (inputCharacter === "b") {
          setUserInputState(previousState => moveCursorLeft(previousState));
          return;
        }

        if (inputCharacter === "d") {
          setUserInputState(previousState => deleteAfterCursor(previousState));
          return;
        }

        // This is usually Ctrl+Backspace or cmd+Backspace in mac
        if (inputCharacter === "u") {
          setUserInputState(previousState => deleteToLineStart(previousState));
          return;
        }

        // This is usually Ctrl+Delete or cmd+Delete in mac
        if (inputCharacter === "k") {
          setUserInputState(previousState => deleteToLineEnd(previousState));
          return;
        }
      }

      if (isMac === false) {
        if (key.leftArrow === true) {
          setUserInputState(previousState => moveCursorWordLeft(previousState));
          return;
        }
        if (key.rightArrow === true) {
          setUserInputState(previousState => moveCursorWordRight(previousState));
          return;
        }
      }
    }

    if (key.meta === true) {
      // Also works as Option+RightArrow on macOS
      if (inputCharacter === "f") {
        setUserInputState(previousState => moveCursorWordRight(previousState));
        return;
      }

      // Also works as Option+LeftArrow on macOS
      if (inputCharacter === "b") {
        setUserInputState(previousState => moveCursorWordLeft(previousState));
        return;
      }

      // For linux, we need to specifically check for Alt+Arrows so we have these here
      if (key.leftArrow === true) {
        setUserInputState(previousState => moveCursorWordLeft(previousState));
        return;
      }
      if (key.rightArrow === true) {
        setUserInputState(previousState => moveCursorWordRight(previousState));
        return;
      }
      // When we press option+fn+delete on macOS, it sends meta+d
      // and for linux, alt+d is the alternative to alt+delete for word delete forward
      if (inputCharacter === "d") {
        setUserInputState(previousState => deleteWordForward(previousState));
        return;
      }

      if (key.backspace === true) {
        setUserInputState(previousState => deleteWordBackward(previousState));
        return;
      }

      if (isWindows) {
        if (key.delete === true) {
          setUserInputState(previousState => deleteWordForward(previousState));
        }
      }
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
    if (key.delete === true) {
      setUserInputState(previousState => deleteAfterCursor(previousState));
      return;
    }

    if (key.backspace === true) {
      setUserInputState(previousState => deleteBeforeCursor(previousState));
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

    if (key.return === true) {
      // Check if there's a selected suggestion for a command that has suggestions
      if (
        selectedSuggestion !== undefined &&
        selectedSuggestion !== null &&
        selectedSuggestion.args.length === 0 &&
        commandHasSuggestions(selectedSuggestion.command)
      ) {
        onSuggestionAccept();
        return;
      }

      const currentText = inputState.segments.map(segment => segment.content).join("");

      // Check if input is a slash command without arguments that has suggestions
      if (currentText.startsWith("/") && currentText.includes(" ") === false) {
        const commandName = currentText.slice(1);
        if (commandHasSuggestions(commandName)) {
          setUserInputState(previousState =>
            insertTextAtCursor({ state: previousState, text: " " }),
          );
          return;
        }
      }

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

      const filteredInputChunk = normalizedInputChunk.replace(/[^\x20-\x7E\n]/g, "");
      if (filteredInputChunk.length === 0) {
        return;
      }

      setUserInputState(previousState =>
        insertTextAtCursor({ state: previousState, text: filteredInputChunk }),
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
        <InputPlaceholder
          isPredicting={isPredicting}
          modelLoadingProgress={modelLoadingProgress}
          promptProcessingProgress={promptProcessingProgress}
          fetchingModelDetails={fetchingModelDetails}
          downloadProgress={downloadProgress}
          predictionSpinnerVisible={predictionSpinnerVisible}
        />
      ) : (
        lines.map((lineText, lineIndex) => {
          const lineStartPos =
            lines.slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0);
          const isCursorLine = lineIndex === cursorLineIndex;

          return (
            <Box key={lineIndex} flexDirection="row" flexWrap="nowrap" width="100%">
              <Box>
                {lineIndex === 0 && isConfirmationActive && <Text color="cyan">(yes/no) </Text>}
                <Text color="cyan">{lineIndex === 0 ? "› " : "  "}</Text>
              </Box>
              <Box>
                <Text>
                  {renderInputWithCursor({
                    fullText: lineText,
                    cursorPosition: isCursorLine ? cursorColumnIndex : -1,
                    pasteRanges,
                    lineStartPos,
                  })}
                </Text>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
};
