import type { HubModel } from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import { measureElement, type DOMElement, useStdin } from "ink";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatSizeBytes1000 } from "../../../formatBytes.js";
import { getCachedModelCatalogOrFetch, parseModelKey } from "../catalogHelpers.js";
import { getDownloadSize } from "../downloadHelpers.js";
import { estimateMessageLinesCount } from "../util.js";
import {
  type ChatUserInputState,
  type InkChatMessage,
  type ModelState,
  type Suggestion,
} from "./types.js";

type LayoutSnapshot = {
  renderedHeight: number;
  availableHeight: number;
};

function isLayoutMonitoringEnabled() {
  const envValue = process.env.LMS_LAYOUT_MONITOR?.toLowerCase();
  return envValue === "1" || envValue === "true" || envValue === "yes";
}

/**
 * DEV ONLY HOOK - Used to see if we have unintended layout overflows
 */
export function useLayoutOverflowMonitor(
  containerRef: RefObject<DOMElement | null>,
  opts?: {
    onOverflow?: (snapshot: LayoutSnapshot) => void;
  },
) {
  const [viewportHeight, setViewportHeight] = useState(() => process.stdout.rows ?? 24);
  const hasReportedOverflowRef = useRef(false);
  useEffect(() => {
    if (!isLayoutMonitoringEnabled()) {
      return;
    }
    const onResize = () => {
      setViewportHeight(process.stdout.rows ?? 24);
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  // No deps - runs every render to catch overflow from any UI changes
  // WARNING: Be careful modifying this effect - calling setState or triggering re-renders can
  // cause infinite loops
  useEffect(() => {
    if (!isLayoutMonitoringEnabled()) {
      return;
    }

    const containerElement = containerRef.current;
    if (containerElement === null) {
      return;
    }

    const measurements = measureElement(containerElement);
    const exceedsViewport = measurements.height > viewportHeight;

    if (!exceedsViewport) {
      hasReportedOverflowRef.current = false;
      return;
    }

    const snapshot: LayoutSnapshot = {
      renderedHeight: measurements.height,
      availableHeight: viewportHeight,
    };

    if (hasReportedOverflowRef.current) {
      return;
    }

    hasReportedOverflowRef.current = true;
    opts?.onOverflow?.(snapshot);
  });
}

export function useModelCatalog(
  client: LMStudioClient,
  shouldFetchModelCatalog: boolean | undefined,
): HubModel[] | null {
  const [modelCatalog, setModelCatalog] = useState<HubModel[] | null>(null);

  useEffect(() => {
    if (shouldFetchModelCatalog !== true) {
      setModelCatalog([]);
      return;
    }

    let isCancelled = false;

    const loadModelCatalog = async () => {
      const availableModels = await getCachedModelCatalogOrFetch(client);
      if (isCancelled === true) {
        return;
      }
      setModelCatalog(availableModels);
    };

    void loadModelCatalog();

    return () => {
      isCancelled = true;
    };
  }, [client, shouldFetchModelCatalog]);

  return modelCatalog;
}

export function useDownloadedModels(
  client: LMStudioClient,
  currentModelIdentifier: string | null,
): { downloadedModels: Array<ModelState>; refreshDownloadedModels: () => void } {
  const [downloadedModels, setDownloadedModels] = useState<Array<ModelState>>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refreshDownloadedModels = useCallback(() => {
    setRefreshTrigger(previous => previous + 1);
  }, []);

  useEffect(() => {
    const fetchModels = async () => {
      const downloadedModels = (await client.system.listDownloadedModels()).filter(
        model => model.type === "llm",
      );
      const loadedModels = await client.llm.listLoaded();

      // Create entry for each loaded model instance
      const loadedModelStates = loadedModels.map(loadedModel => {
        const downloadedModel = downloadedModels.find(model => model.path === loadedModel.path);
        return {
          modelKey: loadedModel.identifier,
          isLoaded: true,
          isCurrent: loadedModel.identifier === currentModelIdentifier,
          displayName: downloadedModel?.displayName ?? loadedModel.path,
        };
      });

      // Get set of paths that are currently loaded
      const loadedPaths = new Set(loadedModels.map(loadedModel => loadedModel.path));

      // Add downloaded models that are NOT loaded
      const downloadedOnlyModels = downloadedModels
        .filter(model => !loadedPaths.has(model.path))
        .map(model => ({
          modelKey: model.modelKey,
          isLoaded: false,
          isCurrent: false,
          displayName: model.displayName,
        }));

      setDownloadedModels([...loadedModelStates, ...downloadedOnlyModels]);
    };

    fetchModels();
  }, [client, currentModelIdentifier, refreshTrigger]);

  return { downloadedModels, refreshDownloadedModels };
}

export function useSuggestionsPerPage(messages: InkChatMessage[]): number {
  const [terminalSize, setTerminalSize] = useState({
    rows: process.stdout.rows ?? 24,
  });
  const suggestionPerPage = useMemo(() => {
    const reservedLines = messages.reduce((acc, message) => {
      return acc + estimateMessageLinesCount(message);
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

export const LARGE_PASTE_THRESHOLD = 512; // Minimum characters to consider input as a paste

/**
 * This hook listens to raw stdin data and uses debouncing to distinguish between normal typing and
 * paste operations. When a paste is detected, it buffers the content and calls the onPaste callback
 * once the paste operation completes.
 *
 * Returns a ref to signal whether normal input processing should be skipped (i.e., during paste).
 * as true indicates that this hook is currently buffering all input as part of a paste operation.
 */
export function useBufferedPasteDetection({ onPaste }: UseBufferedPasteDetectionOpts) {
  const { stdin, setRawMode } = useStdin();

  // Ref to signal that normal input processing should be bypassed during paste operations
  const skipUseInputRef = useRef(false);

  const pasteBufferRef = useRef("");
  const pasteTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const BASE_DELAY = 20; // Minimum debounce delay in milliseconds
  const MAX_DELAY = 1000; // Maximum delay to prevent excessive waiting
  // We scale because larger pastes may lead to slower data arrival rates
  // and we want to adaptively wait longer for bigger pastes
  // The scale adds additional time for each character in the last chunk
  const SCALE = 0.1;

  useEffect(() => {
    if (stdin === undefined) return;

    // We enable raw mode to capture all input data directly
    const wasRaw = stdin.isRaw;
    if (!wasRaw) setRawMode(true);
    stdin.setEncoding("utf8");
    const restoreRawMode = () => {
      if (!wasRaw) setRawMode(false);
    };

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

      // Detect paste start: large input (>512 chars) that's not an escape sequence
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

    const handleProcessExit = () => {
      restoreRawMode();
    };

    const handleSigInt = () => {
      restoreRawMode();
      process.kill(process.pid, "SIGINT");
    };

    const handleSigTerm = () => {
      restoreRawMode();
      process.kill(process.pid, "SIGTERM");
    };

    stdin.on("data", handleData);
    process.once("exit", handleProcessExit);
    process.once("SIGINT", handleSigInt);
    process.once("SIGTERM", handleSigTerm);

    return () => {
      stdin.off("data", handleData);
      process.off("exit", handleProcessExit);
      process.off("SIGINT", handleSigInt);
      process.off("SIGTERM", handleSigTerm);
      restoreRawMode();
      if (pasteTimeoutRef.current) clearTimeout(pasteTimeoutRef.current);
    };
  }, [stdin, onPaste, setRawMode]);

  return skipUseInputRef;
}

export type ConfirmationResponseStatus = "handled" | "invalid" | "ignored";

export interface ConfirmationRequest {
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}

export function useConfirmationPrompt() {
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null);

  const requestConfirmation = useCallback((request: ConfirmationRequest) => {
    setConfirmationRequest(request);
  }, []);

  const clearConfirmation = useCallback(() => {
    setConfirmationRequest(null);
  }, []);

  const handleConfirmationResponse = useCallback(
    async (userInputText: string): Promise<ConfirmationResponseStatus> => {
      if (confirmationRequest === null) {
        return "ignored";
      }
      const normalizedResponse = userInputText.trim().toLowerCase();
      if (normalizedResponse === "y" || normalizedResponse === "yes") {
        setConfirmationRequest(null);
        await confirmationRequest.onConfirm();
        return "handled";
      }
      if (normalizedResponse === "n" || normalizedResponse === "no") {
        setConfirmationRequest(null);
        if (confirmationRequest.onCancel !== undefined) {
          await confirmationRequest.onCancel();
        }
        return "handled";
      }
      return "invalid";
    },
    [confirmationRequest],
  );

  return {
    confirmationRequest,
    isConfirmationActive: confirmationRequest !== null,
    requestConfirmation,
    clearConfirmation,
    handleConfirmationResponse,
  };
}

export interface UseDownloadCommandOpts {
  client: LMStudioClient;
  logInChat: (message: string) => void;
  logErrorInChat: (message: string) => void;
  requestConfirmation: (request: ConfirmationRequest) => void;
  refreshDownloadedModels?: () => void;
  setFetchingModelDetails: (details: { owner: string; name: string } | null) => void;
  setDownloadProgress: (progress: { owner: string; name: string; progress: number } | null) => void;
  downloadAbortControllerRef: React.RefObject<AbortController | null>;
}
export function useDownloadCommand({
  client,
  logInChat,
  logErrorInChat,
  requestConfirmation,
  refreshDownloadedModels,
  setFetchingModelDetails,
  setDownloadProgress,
  downloadAbortControllerRef,
}: UseDownloadCommandOpts) {
  const handleDownloadCommand = useCallback(
    async (commandArguments: string[]) => {
      if (commandArguments.length === 0) {
        logInChat(
          "Please specify a model to download using owner/name. Type /model to see the list.",
        );
        return;
      }

      const modelKeyInput = commandArguments.join(" ").trim();
      if (modelKeyInput.length === 0) {
        logInChat(
          "Please specify a model to download using owner/name. Type /model to see the list.",
        );
        return;
      }

      const parsedModelKey = parseModelKey(modelKeyInput);
      if (parsedModelKey === null) {
        logInChat("Please use the owner/name format, for example google/gemma-3-1b");
        return;
      }

      const { owner, name } = parsedModelKey;

      setFetchingModelDetails({ owner, name });
      let downloadSizeBytes: number;
      try {
        downloadSizeBytes = await getDownloadSize(client, owner, name);
      } catch (error) {
        const errorMessage =
          error instanceof Error && error.message !== undefined ? error.message : String(error);
        setFetchingModelDetails(null);
        logErrorInChat(`Failed to resolve download plan: ${errorMessage}`);
        return;
      }

      if (downloadSizeBytes === 0) {
        setFetchingModelDetails(null);
        logInChat(`${owner}/${name} is already available locally.`);
        return;
      }

      const formattedSize = formatSizeBytes1000(downloadSizeBytes);
      setFetchingModelDetails(null);
      logInChat(
        `Download ${owner}/${name}? This will download approximately ${formattedSize}. Type yes to continue or no to cancel.`,
      );
      requestConfirmation({
        onConfirm: async () => {
          const abortController = new AbortController();
          downloadAbortControllerRef.current = abortController;
          setDownloadProgress({ owner, name, progress: 0 });
          try {
            using downloadPlanner = client.repository.createArtifactDownloadPlanner({
              owner,
              name,
            });
            await downloadPlanner.untilReady();

            await downloadPlanner.download({
              signal: abortController.signal,
              onProgress: update => {
                if (update.totalBytes > 0) {
                  const progress = update.downloadedBytes / update.totalBytes;
                  setDownloadProgress({ owner, name, progress });
                }
              },
            });
            setDownloadProgress(null);
            downloadAbortControllerRef.current = null;
            logInChat(`Download completed: ${owner}/${name}`);
            if (refreshDownloadedModels !== undefined) {
              refreshDownloadedModels();
            }
          } catch (error) {
            // Will not log error if aborted
            const errorMessage =
              error instanceof Error && error.message !== undefined ? error.message : String(error);
            setDownloadProgress(null);
            downloadAbortControllerRef.current = null;
            logErrorInChat(`Download failed for ${owner}/${name}: ${errorMessage}`);
          }
        },
        onCancel: () => {
          logInChat(`Download canceled for ${owner}/${name}.`);
        },
      });
    },
    [
      logInChat,
      client,
      requestConfirmation,
      logErrorInChat,
      refreshDownloadedModels,
      setFetchingModelDetails,
      setDownloadProgress,
      downloadAbortControllerRef,
    ],
  );

  return { handleDownloadCommand };
}

export interface UseSuggestionHandlersOpts {
  selectedSuggestionIndex: number | null;
  setSelectedSuggestionIndex: (
    value: number | null | ((prev: number | null) => number | null),
  ) => void;
  suggestions: Suggestion[];
  suggestionsPerPage: number;
  setUserInputState: (
    value: ChatUserInputState | ((prev: ChatUserInputState) => ChatUserInputState),
  ) => void;
}

export function useSuggestionHandlers({
  selectedSuggestionIndex,
  setSelectedSuggestionIndex,
  suggestions,
  suggestionsPerPage,
  setUserInputState,
}: UseSuggestionHandlersOpts) {
  const handleSuggestionsUp = useCallback(() => {
    if (selectedSuggestionIndex === null) {
      return;
    }
    const nextIndex = Math.max(0, selectedSuggestionIndex - 1);
    setSelectedSuggestionIndex(nextIndex);
  }, [selectedSuggestionIndex, setSelectedSuggestionIndex]);

  const handleSuggestionsDown = useCallback(() => {
    if (selectedSuggestionIndex === null) {
      return;
    }
    const nextIndex = Math.min(suggestions.length - 1, selectedSuggestionIndex + 1);
    setSelectedSuggestionIndex(nextIndex);
  }, [selectedSuggestionIndex, suggestions.length, setSelectedSuggestionIndex]);

  const handleSuggestionsPageLeft = useCallback(() => {
    if (selectedSuggestionIndex === null) {
      return;
    }
    const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
    if (currentPage > 0) {
      const newIndex = (currentPage - 1) * suggestionsPerPage;
      setSelectedSuggestionIndex(newIndex);
    }
  }, [selectedSuggestionIndex, suggestionsPerPage, setSelectedSuggestionIndex]);

  const handleSuggestionsPageRight = useCallback(() => {
    if (selectedSuggestionIndex === null) {
      return;
    }
    const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
    const totalPages = Math.ceil(suggestions.length / suggestionsPerPage);
    if (currentPage < totalPages - 1) {
      const newIndex = (currentPage + 1) * suggestionsPerPage;
      setSelectedSuggestionIndex(newIndex);
    }
  }, [selectedSuggestionIndex, suggestionsPerPage, suggestions.length, setSelectedSuggestionIndex]);

  const handleSuggestionAccept = useCallback(async () => {
    if (selectedSuggestionIndex === null) {
      return;
    }
    const selectedSuggestion = suggestions[selectedSuggestionIndex];
    if (selectedSuggestion === undefined) {
      return;
    }

    const { insertSuggestionAtCursor } = await import("./inputReducer.js");

    const hasArguments = selectedSuggestion.args.length > 0;
    const argumentsText = selectedSuggestion.args.join(" ");
    // Always add a space after the command (even without args) to trigger suggestions
    const suggestionText = hasArguments
      ? `/${selectedSuggestion.command} ${argumentsText}`
      : `/${selectedSuggestion.command} `;
    setUserInputState((previousState: ChatUserInputState) =>
      insertSuggestionAtCursor({ state: previousState, suggestionText }),
    );
  }, [selectedSuggestionIndex, suggestions, setUserInputState]);

  return {
    handleSuggestionsUp,
    handleSuggestionsDown,
    handleSuggestionsPageLeft,
    handleSuggestionsPageRight,
    handleSuggestionAccept,
  };
}
