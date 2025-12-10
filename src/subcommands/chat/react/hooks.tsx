import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatUserInputState,
  type InkChatMessage,
  type ModelState,
  type Suggestion,
} from "./types.js";
import { type LMStudioClient } from "@lmstudio/sdk";
import { estimateMessageLinesCount } from "../util.js";
import { useStdin } from "ink";
import { downloadModelWithProgress, getDownloadSize } from "../downloadHelpers.js";
import { formatSizeBytes1000 } from "../../../formatSizeBytes1000.js";
import {
  getCachedModelCatalogOrFetch,
  findModelInCatalog,
  parseModelKey,
} from "../catalogHelpers.js";
import type { HubModel } from "@lmstudio/lms-shared-types";

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

export type ConfirmationResponseStatus = "handled" | "invalid" | "ignored";

export interface ConfirmationRequest<TPayload> {
  payload: TPayload;
  onConfirm: (payload: TPayload) => void | Promise<void>;
  onCancel?: (payload: TPayload) => void | Promise<void>;
}

export function useConfirmationPrompt<TPayload>() {
  const [confirmationRequest, setConfirmationRequest] =
    useState<ConfirmationRequest<TPayload> | null>(null);

  const requestConfirmation = useCallback((request: ConfirmationRequest<TPayload>) => {
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
        await confirmationRequest.onConfirm(confirmationRequest.payload);
        return "handled";
      }
      if (normalizedResponse === "n" || normalizedResponse === "no") {
        setConfirmationRequest(null);
        if (confirmationRequest.onCancel !== undefined) {
          await confirmationRequest.onCancel(confirmationRequest.payload);
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
  onLog: (message: string) => void;
  onError: (message: string) => void;
  requestConfirmation: (request: ConfirmationRequest<any>) => void;
  shouldFetchModelCatalog: boolean;
  refreshDownloadedModels?: () => void;
}

export function useDownloadCommand({
  client,
  onLog,
  onError,
  requestConfirmation,
  shouldFetchModelCatalog,
  refreshDownloadedModels,
}: UseDownloadCommandOpts) {
  const handleDownloadCommand = useCallback(
    async (commandArguments: string[]) => {
      if (commandArguments.length === 0) {
        onLog("Please specify a model to download using owner/name. Type /model to see the list.");
        return;
      }

      const modelKeyInput = commandArguments.join(" ").trim();
      if (modelKeyInput.length === 0) {
        onLog("Please specify a model to download using owner/name. Type /model to see the list.");
        return;
      }

      const parsedModelKey = parseModelKey(modelKeyInput);
      if (parsedModelKey === null) {
        onLog("Please use the owner/name format, for example meta/llama-3-8b.");
        return;
      }

      const { owner, name } = parsedModelKey;

      if (shouldFetchModelCatalog !== true) {
        onError("Model catalog fetching is disabled. Enable it to use /download command.");
        return;
      }
      onLog(`Fetching model details for ${owner}/${name}...`);

      const catalogModels = await getCachedModelCatalogOrFetch(client);
      if (catalogModels.length === 0) {
        onError("Failed to fetch model catalog. Please check your internet connection.");
        return;
      }

      const matchingModel = findModelInCatalog(catalogModels, `${owner}/${name}`);

      if (matchingModel === undefined) {
        onError(
          "Model not found in the catalog. /download currently supports catalog models only.",
        );
        return;
      }

      let downloadSizeBytes: number;
      try {
        downloadSizeBytes = await getDownloadSize(client, matchingModel.owner, matchingModel.name);
      } catch (error) {
        const errorMessage =
          error instanceof Error && error.message !== undefined ? error.message : String(error);
        onError(`Failed to resolve download plan: ${errorMessage}`);
        return;
      }

      if (downloadSizeBytes === 0) {
        onLog(`${matchingModel.owner}/${matchingModel.name} is already available locally.`);
        return;
      }

      const formattedSize = formatSizeBytes1000(downloadSizeBytes);
      onLog(
        `Download ${matchingModel.owner}/${matchingModel.name}? This will download approximately ${formattedSize}. Type yes to continue or no to cancel.`,
      );
      requestConfirmation({
        payload: {
          type: "downloadModel",
          owner: matchingModel.owner,
          name: matchingModel.name,
        },
        onConfirm: async payload => {
          if (payload.type !== "downloadModel") return;
          onLog(`Downloading ${payload.owner}/${payload.name} in the background...`);

          downloadModelWithProgress(client, payload.owner, payload.name, {
            onComplete: (owner, name) => {
              onLog(`Download completed: ${owner}/${name}`);
              if (refreshDownloadedModels !== undefined) {
                refreshDownloadedModels();
              }
            },
            onError: error => {
              const errorMessage =
                error instanceof Error && error.message !== undefined
                  ? error.message
                  : String(error);
              onError(`Download failed for ${owner}/${name}: ${errorMessage}`);
            },
          }).catch(() => {
            // Error already handled in callback
          });
        },
        onCancel: () => {
          onLog(`Download canceled for ${owner}/${name}.`);
        },
      });
    },
    [shouldFetchModelCatalog, onLog, client, requestConfirmation, onError, refreshDownloadedModels],
  );

  return { handleDownloadCommand };
}

export interface UseSuggestionHandlersOpts {
  selectedSuggestionIndex: number;
  setSelectedSuggestionIndex: (value: number | ((prev: number) => number)) => void;
  sortedSuggestions: Suggestion[];
  suggestionsPerPage: number;
  setUserInputState: (
    value: ChatUserInputState | ((prev: ChatUserInputState) => ChatUserInputState),
  ) => void;
}

export function useSuggestionHandlers({
  selectedSuggestionIndex,
  setSelectedSuggestionIndex,
  sortedSuggestions,
  suggestionsPerPage,
  setUserInputState,
}: UseSuggestionHandlersOpts) {
  const handleSuggestionsUp = useCallback(() => {
    setSelectedSuggestionIndex(previousIndex => Math.max(0, previousIndex - 1));
  }, [setSelectedSuggestionIndex]);

  const handleSuggestionsDown = useCallback(() => {
    setSelectedSuggestionIndex(previousIndex =>
      Math.min(sortedSuggestions.length - 1, previousIndex + 1),
    );
  }, [sortedSuggestions.length, setSelectedSuggestionIndex]);

  const handleSuggestionsPageLeft = useCallback(() => {
    const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
    if (currentPage > 0) {
      const newIndex = (currentPage - 1) * suggestionsPerPage;
      setSelectedSuggestionIndex(newIndex);
    }
  }, [selectedSuggestionIndex, suggestionsPerPage, setSelectedSuggestionIndex]);

  const handleSuggestionsPageRight = useCallback(() => {
    const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
    const totalPages = Math.ceil(sortedSuggestions.length / suggestionsPerPage);
    if (currentPage < totalPages - 1) {
      const newIndex = (currentPage + 1) * suggestionsPerPage;
      setSelectedSuggestionIndex(newIndex);
    }
  }, [
    selectedSuggestionIndex,
    suggestionsPerPage,
    sortedSuggestions.length,
    setSelectedSuggestionIndex,
  ]);

  const handleSuggestionAccept = useCallback(async () => {
    if (selectedSuggestionIndex === -1) {
      return;
    }
    const selectedSuggestion = sortedSuggestions[selectedSuggestionIndex];
    if (selectedSuggestion === undefined) {
      return;
    }

    const { insertSuggestionAtCursor } = await import("./inputReducer.js");

    switch (selectedSuggestion.type) {
      case "model": {
        const suggestionText = `/model ${selectedSuggestion.data.modelKey}`;
        setUserInputState((previousState: ChatUserInputState) =>
          insertSuggestionAtCursor({ state: previousState, suggestionText }),
        );
        return;
      }
      case "command": {
        const suggestionText = `/${selectedSuggestion.data.name} `;
        setUserInputState((previousState: ChatUserInputState) =>
          insertSuggestionAtCursor({ state: previousState, suggestionText }),
        );
        return;
      }
      case "downloadableModel": {
        const suggestionText = `/download ${selectedSuggestion.data.owner}/${selectedSuggestion.data.name}`;
        setUserInputState((previousState: ChatUserInputState) =>
          insertSuggestionAtCursor({ state: previousState, suggestionText }),
        );
        return;
      }
      default: {
        const _exhaustiveCheck: never = selectedSuggestion;
        return _exhaustiveCheck;
      }
    }
  }, [selectedSuggestionIndex, sortedSuggestions, setUserInputState]);

  useEffect(() => {
    if (sortedSuggestions.length === 0) {
      setSelectedSuggestionIndex(-1);
      return;
    }
    if (selectedSuggestionIndex < 0 || selectedSuggestionIndex >= sortedSuggestions.length) {
      setSelectedSuggestionIndex(0);
    }
  }, [selectedSuggestionIndex, setSelectedSuggestionIndex, sortedSuggestions.length]);

  return {
    handleSuggestionsUp,
    handleSuggestionsDown,
    handleSuggestionsPageLeft,
    handleSuggestionsPageRight,
    handleSuggestionAccept,
  };
}
