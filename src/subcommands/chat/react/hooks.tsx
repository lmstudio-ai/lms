import { useStdin } from "ink";
import { useEffect, useRef } from "react";
import { LARGE_PASTE_THRESHOLD } from "./Chat.js";

interface UseBufferedPasteDetectionOpts {
  onPaste: (content: string) => void;
  pasteDelayMs?: number;
}

/**
 * This hook listens to raw stdin data and uses debouncing to distinguish between normal typing and
 * paste operations. When a paste is detected, it buffers the content and calls the onPaste callback
 * once the paste operation completes.
 */
export function useBufferedPasteDetection({ onPaste }: UseBufferedPasteDetectionOpts) {
  const { stdin, setRawMode } = useStdin();

  // Ref to signal that normal input processing should be bypassed during paste operations
  const skipUseInputRef = useRef(false);

  const pasteBufferRef = useRef("");
  const pasteTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const BASE_DELAY = 20; // Minimum debounce delay in milliseconds
  const MAX_DELAY = 1000; // Maximum delay to prevent excessive waiting

  useEffect(() => {
    // We scale because larger pastes may lead to slower data arrival rates
    // and we want to adaptively wait longer for bigger pastes
    const SCALE = 0.1;

    if (stdin === undefined) return;

    // We enable raw mode to capture all input data directly
    const wasRaw = stdin.isRaw;
    if (!wasRaw) setRawMode(true);
    stdin.setEncoding("utf8");

    const schedulePasteFlush = (chunkSize: number) => {
      const bonus = chunkSize * SCALE;
      const delay = Math.min(MAX_DELAY, BASE_DELAY + bonus);

      // Clear any existing timeout to reset the debounce window
      if (pasteTimeoutRef.current) {
        clearTimeout(pasteTimeoutRef.current);
      }

      // Schedule the paste buffer flush
      pasteTimeoutRef.current = setTimeout(() => {
        // Normalize line endings: convert Windows (CRLF) and old Mac (CR) to Unix (LF)
        const normalized = pasteBufferRef.current.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        // Only invoke callback if there's actual content
        if (normalized.length > 0) {
          onPaste(normalized);
        }

        // Reset all paste-related state
        pasteBufferRef.current = "";
        skipUseInputRef.current = false;
        pasteTimeoutRef.current = undefined;
      }, delay);
    };

    const handleData = (inputText: string) => {
      // Check if this is an ANSI escape sequence (e.g., arrow keys, function keys)
      // Escape sequences start with ESC character (\x1b)
      const isEscapeSequence = inputText.startsWith("\x1b");

      // Detect paste start: large input (>1000 chars) that's not an escape sequence
      // and we're not already in a paste operation
      const isPasteStart =
        inputText.length > LARGE_PASTE_THRESHOLD &&
        !isEscapeSequence &&
        pasteBufferRef.current.length === 0;

      // Detect paste continuation: we're already buffering and this isn't an escape sequence
      const isContinuingPaste = pasteBufferRef.current.length > 0 && !isEscapeSequence;

      if (isPasteStart || isContinuingPaste) {
        skipUseInputRef.current = true;
        pasteBufferRef.current += inputText;

        // Schedule a flush with adaptive timing based on data size
        schedulePasteFlush(inputText.length);
      }
    };

    stdin.on("data", handleData);

    return () => {
      stdin.off("data", handleData);
      if (!wasRaw) setRawMode(false);
      if (pasteTimeoutRef.current) clearTimeout(pasteTimeoutRef.current);
    };
  }, [stdin, onPaste, setRawMode]);

  return skipUseInputRef;
}
