import { Box, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef } from "react";
import { useBufferedPasteDetection } from "./hooks.js";
import { InputPlaceholder } from "./InputPlaceholder.js";
import {
  deleteAfterCursor,
  deleteBeforeCursor,
  deleteBeforeCursorCount,
  insertTextAtCursor,
  moveCursorLeft,
  moveCursorRight,
} from "./inputReducer.js";
import { renderInputWithCursor } from "./inputRenderer.js";
import { type ChatUserInputState } from "./types.js";
import { getChipPreviewText } from "../util.js";
import { extractDroppedFilePaths } from "./drop/paths.js";

type ChipRange = { start: number; end: number; kind: "largePaste" | "image" };

const IMAGE_PATH_REGEX = /\.(png|jpe?g|gif|bmp|webp|tiff?)\b/i;
const PATH_SEPARATORS_REGEX = /[\\/]/;
const DROP_BURST_RESET_MS = 120;
const DROP_BURST_MAX_CHARS = 2048;

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
  onPasteFromClipboard: () => void;
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
  onPasteFromClipboard,
  commandHasSuggestions,
  selectedSuggestion,
  predictionSpinnerVisible,
}: ChatInputProps) => {
  const skipUseInputRef = useBufferedPasteDetection({ onPaste });
  const dropBurstRef = useRef<{ text: string; length: number; lastAt: number }>({
    text: "",
    length: 0,
    lastAt: 0,
  });
  const convertingPathRef = useRef(false);
  const disableUserInput =
    (isPredicting ||
      modelLoadingProgress !== null ||
      downloadProgress !== null ||
      fetchingModelDetails !== null ||
      promptProcessingProgress !== null) &&
    isConfirmationActive === false;

  useEffect(() => {
    if (convertingPathRef.current) return;
    if (inputState.segments.length !== 1) return;
    const onlySegment = inputState.segments[0];
    if (onlySegment?.type !== "text") return;
    const rawText = onlySegment.content;
    const stripped = rawText.trim();
    if (stripped.length === 0) return;

    const paths = extractDroppedFilePaths(stripped);
    if (paths.length !== 1) return;
    const candidate = paths[0] ?? "";
    if (candidate.length === 0) return;

    const looksLikeFullPath =
      stripped === candidate ||
      stripped === `"${candidate}"` ||
      stripped === `'${candidate}'` ||
      stripped === `file://${candidate}` ||
      (stripped.includes(candidate) && stripped.length <= candidate.length + 10);

    if (!looksLikeFullPath) return;
    if (!IMAGE_PATH_REGEX.test(candidate)) return;

    convertingPathRef.current = true;
    setUserInputState({
      segments: [{ type: "text", content: "" }],
      cursorOnSegmentIndex: 0,
      cursorInSegmentOffset: 0,
    });
    queueMicrotask(() => {
      onPaste(stripped);
      convertingPathRef.current = false;
    });
  }, [inputState, onPaste, setUserInputState]);

  useInput((inputCharacter, key) => {
    // Check shortcut before skip check to allow image paste even during buffered paste
    const isClipboardPasteShortcut =
      process.platform === "darwin"
        ? (inputCharacter === "v" || inputCharacter === "\x16") && key.ctrl === true
        : inputCharacter === "v" && key.meta === true;
    if (isClipboardPasteShortcut) {
      onPasteFromClipboard();
      return;
    }

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

    if (disableUserInput) {
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

      const currentText = inputState.segments
        .map(segment => (segment.type === "text" ? segment.content : ""))
        .join("");

      // Check if input is a slash command without arguments that has suggestions
      // Only auto-insert space if input is a single text segment (no chips)
      if (
        currentText.startsWith("/") &&
        currentText.includes(" ") === false &&
        inputState.segments.length === 1 &&
        inputState.segments[0]?.type === "text"
      ) {
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

      // Filter out control characters and non-BMP characters (via surrogate pairs).
      // We currently don't support unicode beyond BMP due to UTF-16 handling complexities.
      // Blocked: C0 controls (except newline), DEL, C1 controls, surrogate pairs (0xD800-0xDFFF)
      const filteredInputChunk = normalizedInputChunk.replace(
        // eslint-disable-next-line no-control-regex
        /[\x00-\x09\x0B-\x1F\x7F\x80-\x9F\uD800-\uDFFF]/g,
        "",
      );
      if (filteredInputChunk.length === 0) {
        return;
      }

      const now = Date.now();
      const sinceLast = now - dropBurstRef.current.lastAt;
      if (sinceLast > DROP_BURST_RESET_MS) {
        dropBurstRef.current.text = "";
        dropBurstRef.current.length = 0;
      }
      dropBurstRef.current.lastAt = now;
      dropBurstRef.current.text += filteredInputChunk;
      dropBurstRef.current.length += filteredInputChunk.length;
      if (dropBurstRef.current.text.length > DROP_BURST_MAX_CHARS) {
        dropBurstRef.current.text = dropBurstRef.current.text.slice(-DROP_BURST_MAX_CHARS);
      }

      // Fallback: if Ink delivers a drop/paste as a multi-char chunk (not caught by raw paste
      // detection), treat image-looking paths as a paste so they can attach as chips.
      if (
        filteredInputChunk.length > 1 &&
        IMAGE_PATH_REGEX.test(filteredInputChunk) &&
        (filteredInputChunk.includes("file://") || PATH_SEPARATORS_REGEX.test(filteredInputChunk))
      ) {
        const extracted = extractDroppedFilePaths(filteredInputChunk);
        if (extracted.length > 0) {
          onPaste(filteredInputChunk);
          return;
        }
      }

      setUserInputState(previousState =>
        insertTextAtCursor({ state: previousState, text: filteredInputChunk }),
      );

      const burstText = dropBurstRef.current.text;
      if (
        burstText.length > 0 &&
        IMAGE_PATH_REGEX.test(burstText) &&
        (burstText.includes("file://") ||
          PATH_SEPARATORS_REGEX.test(burstText) ||
          burstText.includes("[200~") ||
          burstText.includes("[201~"))
      ) {
        const extracted = extractDroppedFilePaths(burstText);
        if (extracted.length > 0) {
          const deleteCount = dropBurstRef.current.length;
          dropBurstRef.current.text = "";
          dropBurstRef.current.length = 0;
          setUserInputState(previousState => deleteBeforeCursorCount(previousState, deleteCount));
          onPaste(burstText);
          return;
        }
      }
    }
  });

  const { fullText, cursorPosition, chipRanges } = useMemo(() => {
    let fullText = "";
    let cursorPosition = 0;
    const chipRanges: ChipRange[] = [];

    for (let index = 0; index < inputState.segments.length; index++) {
      const segment = inputState.segments[index];

      if (segment.type === "chip") {
        const placeholder = getChipPreviewText(segment.data);
        const startPos = fullText.length;

        if (index < inputState.cursorOnSegmentIndex) {
          cursorPosition += placeholder.length;
        } else if (index === inputState.cursorOnSegmentIndex) {
          cursorPosition += inputState.cursorInSegmentOffset === 0 ? 0 : placeholder.length;
        }

        fullText += placeholder;
        chipRanges.push({ start: startPos, end: fullText.length, kind: segment.data.kind });
      } else {
        if (index < inputState.cursorOnSegmentIndex) {
          cursorPosition += segment.content.length;
        } else if (index === inputState.cursorOnSegmentIndex) {
          cursorPosition += inputState.cursorInSegmentOffset;
        }

        fullText += segment.content;
      }
    }

    return { fullText, cursorPosition, chipRanges };
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
                    chipRanges,
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
