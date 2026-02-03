import { produce } from "@lmstudio/immer-with-plugins";
import { type Chat, type LLM, type LLMPredictionStats, type LMStudioClient } from "@lmstudio/sdk";
import { Box, type DOMElement, useApp, Text } from "ink";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { displayVerboseStats, getLargePastePlaceholderText } from "../util.js";
import { ChatInput } from "./ChatInput.js";
import { ChatMessagesList } from "./ChatMessagesList.js";
import { ChatSuggestions } from "./ChatSuggestions.js";
import { SlashCommandHandler } from "./SlashCommandHandler.js";
import {
  LARGE_PASTE_THRESHOLD,
  useConfirmationPrompt,
  useDownloadCommand,
  useDownloadedModels,
  useLayoutOverflowMonitor,
  useModelCatalog,
  useSuggestionHandlers,
  useSuggestionsPerPage,
} from "./hooks.js";
import { insertPasteAtCursor } from "./inputReducer.js";
import { createSlashCommands } from "./slashCommands.js";
import type { ChatUserInputState, InkChatMessage, Suggestion } from "./types.js";

// Freezes streaming content into static chunks at natural breaks to reduce re-renders.
// Uses multiple boundaries to handle different content (best effort):
// - Newline: Freezes at line breaks - preserves formatting
// - Period: Fallback for long text without line breaks - loses formatting
// Higher minChunk = freeze less often but more work per token.
// Lower minChunk = many static inserts and reconciliation work.
const STREAMING_ASSISTANT_STATIC_BOUNDARIES = [
  { token: "\n", minChunk: 200 },
  { token: ".", minChunk: 1000 },
];

interface ChatComponentProps {
  client: LMStudioClient;
  llm?: LLM;
  chat: Chat;
  onExit: () => void;
  stats?: true;
  ttl?: number;
  shouldFetchModelCatalog?: boolean;
}

export const emptyChatInputState: ChatUserInputState = {
  segments: [{ type: "text", content: "" }],
  cursorOnSegmentIndex: 0,
  cursorInSegmentOffset: 0,
};

export const ChatComponent = React.memo(
  ({ client, llm, chat, onExit, stats, ttl, shouldFetchModelCatalog }: ChatComponentProps) => {
    const { exit } = useApp();
    const rootUiRef = useRef<DOMElement | null>(null);
    const [messages, setMessages] = useState<InkChatMessage[]>([
      {
        type: "welcome",
      },
    ]);

    const [userInputState, setUserInputState] = useState<ChatUserInputState>(emptyChatInputState);
    const [isPredicting, setIsPredicting] = useState(false);
    const [showPredictionSpinner, setShowPredictionSpinner] = useState(false);
    const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [flickerCount, setFlickerCount] = useState(0);
    const [fetchingModelDetails, setFetchingModelDetails] = useState<{
      owner: string;
      name: string;
    } | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<{
      owner: string;
      name: string;
      progress: number;
    } | null>(null);
    const lastPredictionStatsRef = useRef<LLMPredictionStats | null>(null);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number | null>(null);
    const { isConfirmationActive, requestConfirmation, handleConfirmationResponse } =
      useConfirmationPrompt();
    const [promptProcessingProgress, setPromptProcessingProgress] = useState<number | null>(null);
    const abortControllerRef = useRef<AbortController | null>(new AbortController());
    const downloadAbortControllerRef = useRef<AbortController | null>(null);
    const modelLoadingAbortControllerRef = useRef<AbortController | null>(null);
    const chatRef = useRef<Chat>(chat);
    const llmRef = useRef<LLM | null>(llm ?? null);
    const { downloadedModels, refreshDownloadedModels } = useDownloadedModels(
      client,
      llmRef.current !== null ? llmRef.current.identifier : null,
    );
    const modelCatalog = useModelCatalog(client, shouldFetchModelCatalog);
    const handleExit = useCallback(() => {
      if (abortControllerRef.current?.signal.aborted === false) {
        abortControllerRef.current?.abort();
      }
      onExit();
      exit();
      process.exit(0);
    }, [onExit, exit]);

    const addMessage = useCallback((message: InkChatMessage) => {
      setMessages(previousMessages => {
        return [...previousMessages, message];
      });
    }, []);

    useLayoutOverflowMonitor(rootUiRef, {
      onOverflow: snapshot => {
        setFlickerCount(prev => prev + 1);
        setStatusMessage(
          `Layout Overflow - ${snapshot.renderedHeight} rendered height exceeds ${snapshot.availableHeight} available height`,
        );
      },
    });

    const logInChat = useCallback(
      (logText: string) => {
        addMessage({ type: "log", content: logText });
      },
      [addMessage],
    );

    const logErrorInChat = useCallback(
      (logText: string) => {
        addMessage({ type: "error", content: logText });
      },
      [addMessage],
    );

    const { handleDownloadCommand } = useDownloadCommand({
      client,
      logInChat,
      logErrorInChat,
      refreshDownloadedModels,
      requestConfirmation,
      setFetchingModelDetails,
      setDownloadProgress,
      downloadAbortControllerRef,
    });

    const commandHandler = useMemo(() => {
      const handler = new SlashCommandHandler();
      handler.addToIgnoreList("think");
      handler.addToIgnoreList("no_think");
      const commands = createSlashCommands({
        client,
        llmRef,
        chatRef,
        exitApp: handleExit,
        ttl,
        addMessage,
        setMessages,
        setUserInputState,
        downloadedModels,
        modelCatalog,
        handleDownloadCommand,
        logInChat,
        logErrorInChat,
        shouldFetchModelCatalog,
        commandHandler: handler,
        setModelLoadingProgress,
        modelLoadingAbortControllerRef,
        lastPredictionStatsRef,
      });
      handler.setCommands(commands);
      return handler;
    }, [
      client,
      handleExit,
      ttl,
      addMessage,
      downloadedModels,
      modelCatalog,
      handleDownloadCommand,
      logInChat,
      logErrorInChat,
      shouldFetchModelCatalog,
    ]);

    const suggestions = useMemo<Suggestion[]>(() => {
      if (userInputState.segments.length === 0) {
        return [];
      }
      const firstSegment = userInputState.segments[0];
      const inputText = firstSegment.content;
      return commandHandler.getSuggestions({
        input: inputText,
        shouldShowSuggestions: !isConfirmationActive && !isPredicting && inputText.startsWith("/"),
      });
    }, [commandHandler, isConfirmationActive, isPredicting, userInputState.segments]);

    const suggestionsPerPage = useSuggestionsPerPage(messages);
    const areSuggestionsVisible = useMemo(() => suggestions.length > 0, [suggestions]);
    // As selectedSuggestionIndex can be out of bounds due to changes in suggestions,
    // we normalize it here.
    const normalizedSelectedSuggestionIndex = useMemo(() => {
      if (suggestions.length === 0) {
        return null;
      }
      if (selectedSuggestionIndex === null || selectedSuggestionIndex < 0) {
        return 0;
      }
      if (selectedSuggestionIndex >= suggestions.length) {
        return suggestions.length - 1;
      }
      return selectedSuggestionIndex;
    }, [selectedSuggestionIndex, suggestions.length]);

    const {
      handleSuggestionsUp,
      handleSuggestionsDown,
      handleSuggestionsPageLeft,
      handleSuggestionsPageRight,
      handleSuggestionAccept,
    } = useSuggestionHandlers({
      selectedSuggestionIndex: normalizedSelectedSuggestionIndex,
      setSelectedSuggestionIndex,
      suggestions,
      suggestionsPerPage,
      setUserInputState,
    });

    const handleAbortPrediction = useCallback(() => {
      const hasAssistantMessage = messages.length > 0 && messages.at(-1)?.type === "assistant";

      if (hasAssistantMessage === true) {
        setMessages(
          produce(draftMessages => {
            if (draftMessages.length === 0) {
              return;
            }
            const lastMessageIndex = draftMessages.length - 1;
            const lastMessage = draftMessages[lastMessageIndex];
            if (lastMessage === undefined || lastMessage.type !== "assistant") {
              return;
            }
            if (lastMessage.content.length === 0) {
              return;
            }
            lastMessage.stoppedByUser = true;
          }),
        );
      } else {
        logInChat("Prediction aborted by user.");
      }
      if (
        abortControllerRef.current !== null &&
        abortControllerRef.current.signal.aborted === false
      ) {
        abortControllerRef.current.abort();
      }
      setIsPredicting(false);
      setShowPredictionSpinner(false);
    }, [logInChat, messages]);

    const handleAbortDownload = useCallback(() => {
      if (downloadProgress === null && fetchingModelDetails === null) {
        return;
      }

      logInChat("Download interrupted. Continue download in background?");
      requestConfirmation({
        onConfirm: () => {
          handleExit();
        },
        onCancel: () => {
          if (
            downloadAbortControllerRef.current !== null &&
            downloadAbortControllerRef.current.signal.aborted === false
          ) {
            downloadAbortControllerRef.current.abort();
            downloadAbortControllerRef.current = null;
          }
          handleExit();
        },
      });
    }, [downloadProgress, fetchingModelDetails, handleExit, logInChat, requestConfirmation]);

    const handleAbortModelLoading = useCallback(() => {
      if (modelLoadingProgress === null) {
        return;
      }

      if (
        modelLoadingAbortControllerRef.current !== null &&
        modelLoadingAbortControllerRef.current.signal.aborted === false
      ) {
        modelLoadingAbortControllerRef.current.abort();
        modelLoadingAbortControllerRef.current = null;
      }
      setModelLoadingProgress(null);
    }, [modelLoadingProgress]);

    const handlePaste = useCallback((content: string) => {
      const normalizedContent = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

      if (normalizedContent.length === 0) {
        return;
      }

      setUserInputState(previousState =>
        insertPasteAtCursor({
          state: previousState,
          content: normalizedContent,
          largePasteThreshold: LARGE_PASTE_THRESHOLD,
        }),
      );
    }, []);

    const handleSubmit = useCallback(async () => {
      // Collect the full text input from the userInputState
      const userInputText = userInputState.segments
        .map(segment => segment.content)
        .join("")
        .trim();
      // Clear the input state
      setUserInputState(emptyChatInputState);
      const confirmationResponse = await handleConfirmationResponse(userInputText);
      if (confirmationResponse === "handled") {
        return;
      }
      if (confirmationResponse === "invalid") {
        logInChat("Please answer 'yes' or 'no'");
        return;
      }

      if (userInputText.length === 0) {
        return;
      }

      if (userInputText.startsWith("/") && userInputState.segments.length === 1) {
        const selectedSuggestion =
          normalizedSelectedSuggestionIndex !== null
            ? suggestions[normalizedSelectedSuggestionIndex]
            : undefined;
        const { command, argumentsText } = SlashCommandHandler.parseSlashCommand(
          userInputText,
          selectedSuggestion,
        );

        if (command === null) {
          return;
        }

        // Check if the command is in exception list, if not,
        // execute it.
        if (commandHandler.commandIsIgnored(command) === false) {
          const wasCommandHandled = await commandHandler.execute(command, argumentsText);
          if (wasCommandHandled === false) {
            logInChat(`Unknown command: ${userInputText}`);
          }
          return;
        }
      }

      if (userInputText === "exit" || userInputText === "quit") {
        handleExit();
        return;
      }

      if (llmRef.current === null) {
        logErrorInChat("No model loaded. Please load a model using /model");
        return;
      }

      if (isPredicting) {
        logInChat(
          "A prediction is already in progress. Please wait for it to finish or press CTRL+C to abort it.",
        );
        return;
      }

      // If nothing else, proceed with normal message submission
      setIsPredicting(true);
      setPromptProcessingProgress(null);
      setShowPredictionSpinner(true);
      if (
        abortControllerRef.current === null ||
        abortControllerRef.current.signal.aborted === true
      ) {
        abortControllerRef.current = new AbortController();
      }
      const signal = abortControllerRef.current.signal;

      try {
        chatRef.current.append("user", userInputText);
        addMessage({
          type: "user",
          content: userInputState.segments.map(segment => {
            if (segment.type === "largePaste") {
              const placeholder = getLargePastePlaceholderText(segment.content);
              return {
                type: "largePaste",
                text: placeholder,
              };
            }
            return { type: segment.type, text: segment.content };
          }),
        });
        const result = await llmRef.current.respond(chatRef.current, {
          onFirstToken() {
            setShowPredictionSpinner(false);
            setPromptProcessingProgress(null);
            chatRef.current.append("assistant", "");
            const displayName =
              llmRef.current?.displayName ?? llmRef.current?.modelKey ?? "Assistant";
            setMessages(
              produce(draftMessages => {
                draftMessages.push({
                  type: "assistant",
                  content: [],
                  displayName,
                  stoppedByUser: false,
                });
              }),
            );
          },
          onPromptProcessingProgress(progress) {
            if (signal.aborted) {
              return;
            }
            if (progress === 1) {
              setPromptProcessingProgress(null);
            } else if (progress !== promptProcessingProgress) {
              setPromptProcessingProgress(progress);
            }
          },
          onPredictionFragment(fragment) {
            if (signal.aborted) {
              return;
            }
            chatRef.current.at(-1).appendText(fragment.content);
            if (
              fragment.reasoningType === "reasoningStartTag" ||
              fragment.reasoningType === "reasoningEndTag"
            ) {
              return;
            }
            if (fragment.isStructural) {
              return;
            }
            setMessages(
              produce(draftMessages => {
                if (draftMessages.length === 0) {
                  return;
                }
                const lastMessage = draftMessages[draftMessages.length - 1];
                if (lastMessage === undefined || lastMessage.type !== "assistant") {
                  return;
                }
                const targetPartType = fragment.reasoningType === "none" ? "response" : "reasoning";
                const parts = lastMessage.content;
                const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
                // Append to the current part when the type matches; otherwise start a new part.
                if (lastPart !== undefined && lastPart.type === targetPartType) {
                  lastPart.text += fragment.content;
                } else {
                  parts.push({
                    type: targetPartType,
                    text: fragment.content,
                  });
                }

                // Once we have more than one part, older parts are "done" and can be graduated
                // to static messages (Ink <Static> in the list renders these once).
                while (parts.length > 1) {
                  const staticPart = parts.shift();
                  if (staticPart === undefined) {
                    break;
                  }
                  draftMessages.splice(draftMessages.length - 1, 0, {
                    type: "assistant",
                    content: [staticPart],
                    displayName: lastMessage.displayName,
                    stoppedByUser: false,
                  });
                }

                const activePart = parts[0];
                if (activePart === undefined) {
                  return;
                }

                // Keep a small live tail to reduce re-render cost; graduate to static only at a newline so
                // the current line stays visually contiguous.
                let boundaryIndex = -1;
                let boundaryToken: string | undefined;
                for (const boundary of STREAMING_ASSISTANT_STATIC_BOUNDARIES) {
                  const minChunk = boundary.minChunk;
                  if (activePart.text.length <= minChunk) {
                    continue;
                  }
                  const index = activePart.text.lastIndexOf(boundary.token);
                  if (index >= 0) {
                    const candidateLength = index + boundary.token.length;
                    if (candidateLength < minChunk) {
                      continue;
                    }
                    boundaryIndex = index;
                    boundaryToken = boundary.token;
                    break;
                  }
                }
                if (boundaryIndex >= 0 && boundaryToken !== undefined) {
                  const staticLength = boundaryIndex + boundaryToken.length;
                  // Skip if boundary is at the end - splitting would leave empty active text
                  if (staticLength === activePart.text.length) {
                    return;
                  }
                  let staticText = activePart.text.slice(0, staticLength);
                  // Drop exactly one trailing newline to compensate for Static boundary spacing
                  if (staticText.endsWith("\r\n")) {
                    staticText = staticText.slice(0, -2);
                  } else if (staticText.endsWith("\n") || staticText.endsWith("\r")) {
                    staticText = staticText.slice(0, -1);
                  }
                  activePart.text = activePart.text.slice(staticLength);
                  draftMessages.splice(draftMessages.length - 1, 0, {
                    type: "assistant",
                    content: [{ type: activePart.type, text: staticText }],
                    displayName: lastMessage.displayName,
                    stoppedByUser: false,
                  });
                }
              }),
            );
          },
          signal,
        });
        if (stats === true) {
          displayVerboseStats(result.stats, logInChat);
        }
        lastPredictionStatsRef.current = result.stats;
      } catch (error) {
        lastPredictionStatsRef.current = null;
        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
          if (errorMessage.includes("unload") || errorMessage.includes("not loaded")) {
            const currentModelKey = llmRef.current.modelKey;
            logErrorInChat(`${error.message}`);
            logInChat(`Would you like to reload the model?`);
            requestConfirmation({
              onConfirm: async () => {
                logInChat("Reloading model...");
                setModelLoadingProgress(0);
                try {
                  llmRef.current = await client.llm.model(currentModelKey, {
                    verbose: false,
                    ttl,
                    onProgress(progress) {
                      setModelLoadingProgress(progress);
                    },
                  });
                  logInChat(`Model reloaded: ${llmRef.current.displayName}`);
                  setModelLoadingProgress(null);
                } catch (reloadError) {
                  setModelLoadingProgress(null);
                  const reloadErrorMessage =
                    reloadError instanceof Error && reloadError.message !== undefined
                      ? reloadError.message
                      : String(reloadError);
                  logErrorInChat(`Failed to reload model: ${reloadErrorMessage}`);
                }
              },
              onCancel: () => {
                logInChat("Model reload cancelled.");
                handleExit();
              },
            });
          } else {
            logErrorInChat(`Prediction error: ${error.message}`);
          }
        }
      } finally {
        setIsPredicting(false);
        setPromptProcessingProgress(null);
        setShowPredictionSpinner(false);
        abortControllerRef.current = null;
      }
    }, [
      userInputState.segments,
      handleConfirmationResponse,
      isPredicting,
      logInChat,
      normalizedSelectedSuggestionIndex,
      suggestions,
      commandHandler,
      handleExit,
      logErrorInChat,
      addMessage,
      stats,
      promptProcessingProgress,
      requestConfirmation,
      client.llm,
      ttl,
    ]);

    return (
      <Box
        ref={rootUiRef}
        flexDirection="column"
        width={"95%"}
        overflow="hidden"
        flexGrow={0}
        flexShrink={0}
      >
        <ChatMessagesList
          messages={messages}
          modelName={llmRef.current?.identifier ?? null}
          isPredicting={isPredicting}
        />
        {statusMessage !== null && (
          <Box>
            <Text color="yellow">
              {statusMessage} + {flickerCount}
            </Text>
          </Box>
        )}
        <ChatInput
          inputState={userInputState}
          isPredicting={isPredicting}
          isConfirmationActive={isConfirmationActive}
          areSuggestionsVisible={areSuggestionsVisible}
          modelLoadingProgress={modelLoadingProgress}
          promptProcessingProgress={promptProcessingProgress}
          fetchingModelDetails={fetchingModelDetails}
          downloadProgress={downloadProgress}
          setUserInputState={setUserInputState}
          onSubmit={handleSubmit}
          onAbortPrediction={handleAbortPrediction}
          onAbortDownload={handleAbortDownload}
          onAbortModelLoading={handleAbortModelLoading}
          onExit={handleExit}
          onSuggestionsUp={handleSuggestionsUp}
          onSuggestionsDown={handleSuggestionsDown}
          onSuggestionsPageLeft={handleSuggestionsPageLeft}
          onSuggestionsPageRight={handleSuggestionsPageRight}
          onSuggestionAccept={handleSuggestionAccept}
          onPaste={handlePaste}
          commandHasSuggestions={commandName => {
            const command = commandHandler
              .list()
              .find(cmd => cmd.name.toLowerCase() === commandName.toLowerCase());
            return command !== undefined && command.buildSuggestions !== undefined;
          }}
          selectedSuggestion={
            normalizedSelectedSuggestionIndex !== null
              ? suggestions[normalizedSelectedSuggestionIndex]
              : null
          }
          predictionSpinnerVisible={showPredictionSpinner}
        />
        {suggestions.length > 0 && (
          <ChatSuggestions
            suggestions={suggestions}
            selectedSuggestionIndex={normalizedSelectedSuggestionIndex}
            suggestionsPerPage={suggestionsPerPage}
            getSuggestionLabel={suggestion => commandHandler.getSuggestionLabel(suggestion)}
          />
        )}
      </Box>
    );
  },
);
