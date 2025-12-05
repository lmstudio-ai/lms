import { useEffect, useMemo, useRef, useState } from "react";
import { type InkChatMessage, type ModelState, type Suggestion } from "./types.js";
import { type LMStudioClient } from "@lmstudio/sdk";
import { countMessageLines } from "../util.js";
import { useStdin } from "ink";

export function useSortedSuggestions(suggestions: Suggestion[]): Suggestion[] {
  return useMemo(() => {
    return [...suggestions].sort((a, b) => {
      if (a.type === "model" && b.type === "model") {
        if (a.data.isCurrent && !b.data.isCurrent) return -1;
        if (!a.data.isCurrent && b.data.isCurrent) return 1;
        if (a.data.isLoaded && !b.data.isLoaded) return -1;
        if (!a.data.isLoaded && b.data.isLoaded) return 1;
        return a.data.modelKey.localeCompare(b.data.modelKey);
      }
      if (a.type === "command" && b.type === "command") {
        return a.data.name.localeCompare(b.data.name);
      }
      // We should not have mixed types here, but just in case
      // prioritize model suggestions
      if (a.type === "model" && b.type === "command") return -1;
      if (a.type === "command" && b.type === "model") return 1;
      return 0;
    });
  }, [suggestions]);
}

export function useDownloadedModels(
  client: LMStudioClient,
  currentModelIdentifier: string | null,
): Array<ModelState> {
  const [downloadedModels, setDownloadedModels] = useState<Array<ModelState>>([]);
  useEffect(() => {
    const fetchModels = async () => {
      const downloadedModels = await client.system.listDownloadedModels();
      const loadedModels = await client.llm.listLoaded();
      const models = downloadedModels.map(model => {
        const loadedCount = loadedModels.filter(
          loadedModel => loadedModel.path === model.path,
        ).length;
        const isCurrent = loadedModels.some(
          loadedModel =>
            loadedModel.path === model.path && loadedModel.identifier === currentModelIdentifier,
        );
        return {
          modelKey: model.modelKey,
          isLoaded: loadedCount > 0,
          isCurrent,
        };
      });
      setDownloadedModels(models);
    };

    fetchModels();
  }, [client, currentModelIdentifier]);
  return downloadedModels;
}

export function useSuggestionsPerPage(messages: InkChatMessage[]): number {
  const [terminalSize, setTerminalSize] = useState({
    rows: process.stdout.rows ?? 24,
  });
  const suggestionPerPage = useMemo(() => {
    const reservedLines = messages.reduce((acc, message) => {
      return acc + countMessageLines(message);
    }, 8); // +6 for input prompt and padding
    return Math.max(5, terminalSize.rows - reservedLines);
  }, [messages, terminalSize.rows]);
  useEffect(() => {
    const onResize = () => {
      setTerminalSize({
        rows: process.stdout.rows ?? 24,
      });
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  return suggestionPerPage;
}

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
  const LARGE_PASTE_THRESHOLD = 1000; // Minimum characters to consider input as a paste

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
