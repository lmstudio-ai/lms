import { type LLM, type LMStudioClient, type Chat } from "@lmstudio/sdk";
import { produce } from "@lmstudio/immer-with-plugins";
import { Box, Text, useApp } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatInput } from "./ChatInput.js";
import { ChatMessagesList } from "./ChatMessagesList.js";
import { ChatSuggestions } from "./ChatSuggestions.js";
import { SlashCommandHandler, type SlashCommand } from "./SlashCommandHandler.js";
import { insertPasteAtCursor } from "./inputReducer.js";
import {
  LARGE_PASTE_THRESHOLD,
  useConfirmationPrompt,
  useDownloadCommand,
  useDownloadedModels,
  useModelCatalog,
  useSuggestionHandlers,
  useSuggestionsPerPage,
} from "./hooks.js";
import type { ChatUserInputState, InkChatMessage, Suggestion } from "./types.js";
import { displayVerboseStats } from "../util.js";
import { createSlashCommands } from "./slashCommands.js";

interface ChatComponentProps {
  client: LMStudioClient;
  llm?: LLM;
  chat: Chat;
  onExit: () => void;
  stats?: true;
  ttl?: number;
  shouldFetchModelCatalog?: boolean;
}

const commandHandler = new SlashCommandHandler();

const emptyChatInputState: ChatUserInputState = {
  segments: [{ type: "text", content: "" }],
  cursorOnSegmentIndex: 0,
  cursorInSegmentOffset: 0,
};

type ChatConfirmationPayload =
  | {
      type: "reloadModel";
      originalInput: ChatUserInputState;
      modelKey: string;
    }
  | {
      type: "downloadModel";
      owner: string;
      name: string;
    };

export const ChatComponent = React.memo(
  ({ client, llm, chat, onExit, stats, ttl, shouldFetchModelCatalog }: ChatComponentProps) => {
    const { exit } = useApp();
    const [messages, setMessages] = useState<InkChatMessage[]>([
      {
        type: "welcome",
      },
    ]);

    const [userInputState, setUserInputState] = useState<ChatUserInputState>(emptyChatInputState);
    const [isPredicting, setIsPredicting] = useState(false);
    const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
    const { isConfirmationActive, requestConfirmation, handleConfirmationResponse } =
      useConfirmationPrompt<ChatConfirmationPayload>();
    const [promptProcessingProgress, setPromptProcessingProgress] = useState(-1);
    const abortControllerRef = useRef<AbortController | null>(new AbortController());
    const chatRef = useRef<Chat>(chat);
    const llmRef = useRef<LLM | null>(llm ?? null);
    const { downloadedModels, refreshDownloadedModels } = useDownloadedModels(
      client,
      llmRef.current !== null ? llmRef.current.identifier : null,
    );
    const modelCatalog = useModelCatalog(client, shouldFetchModelCatalog);
    const suggestions = useMemo<Suggestion[]>(() => {
      if (userInputState.segments.length === 0) {
        return [];
      }
      const firstSegment = userInputState.segments[0];
      const inputText = firstSegment.content;
      return commandHandler.getSuggestions({
        input: inputText,
        isPredicting,
        isConfirmationActive,
      });
    }, [isConfirmationActive, isPredicting, userInputState]);
    const suggestionsPerPage = useSuggestionsPerPage(messages);
    const areSuggestionsVisible = useMemo(() => suggestions.length > 0, [suggestions]);
    // As selectedSuggestionIndex can be out of bounds due to changes in suggestions,
    // we normalize it here.
    const normalizedSelectedSuggestionIndex = useMemo(() => {
      if (suggestions.length === 0) {
        return -1;
      }
      if (selectedSuggestionIndex < 0) {
        return 0;
      }
      if (selectedSuggestionIndex >= suggestions.length) {
        return suggestions.length - 1;
      }
      return selectedSuggestionIndex;
    }, [selectedSuggestionIndex, suggestions.length]);

    const addMessage = useCallback((message: InkChatMessage) => {
      setMessages(previousMessages => {
        return [...previousMessages, message];
      });
    }, []);

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
      onLog: logInChat,
      onError: logErrorInChat,
      refreshDownloadedModels,
      requestConfirmation,
      shouldFetchModelCatalog: shouldFetchModelCatalog ?? false,
    });

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

    const handleExit = useCallback(() => {
      abortControllerRef.current?.abort();
      onExit();
      exit();
      process.exit(0);
    }, [onExit, exit]);

    const slashCommands = useMemo<SlashCommand[]>(() => {
      return createSlashCommands({
        client,
        llmRef,
        chatRef,
        exitApp: handleExit,
        ttl,
        abortControllerRef,
        addMessage,
        setMessages,
        setUserInputState,
        downloadedModels,
        modelCatalog,
        handleDownloadCommand,
        logInChat,
        logErrorInChat,
        shouldFetchModelCatalog,
        commandHandler,
        setModelLoadingProgress,
      });
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

    const handleAbortPrediction = useCallback(() => {
      const hasAssistantMessage =
        messages.length > 0 && messages[messages.length - 1]?.type === "assistant";

      if (hasAssistantMessage === true) {
        setMessages(previousMessages =>
          produce(previousMessages, draftMessages => {
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
      if (abortControllerRef.current !== null) {
        abortControllerRef.current.abort();
      }
      setIsPredicting(false);
    }, [logInChat, messages]);

    const handlePaste = useCallback((content: string) => {
      const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

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
        const { command, argumentsText } = SlashCommandHandler.parseSlashCommand(
          userInputText,
          suggestions[normalizedSelectedSuggestionIndex],
        );
        if (command === null) {
          return;
        }
        const wasCommandHandled = await commandHandler.execute(command, argumentsText);
        if (wasCommandHandled === false) {
          logInChat(`Unknown command: ${userInputText}`);
        }
        return;
      }

      if (userInputText === "exit" || userInputText === "quit") {
        handleExit();
        return;
      }

      if (llmRef.current === null) {
        logErrorInChat("No model loaded. Please load a model using /model [model_key]");
        return;
      }

      // If nothing else, proceed with normal message submission
      setIsPredicting(true);
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
              if (segment.content.length > 50) {
                return {
                  type: "largePaste",
                  text: `[Pasted ${segment.content.replace(/\r\n|\r|\n/g, "").slice(0, 50)}...]`,
                };
              }
              return { type: segment.type, text: segment.content };
            }
            return { type: segment.type, text: segment.content };
          }),
        });
        const result = await llmRef.current.respond(chatRef.current, {
          onFirstToken() {
            chatRef.current.append("assistant", "");
            const displayName =
              llmRef.current?.displayName ?? llmRef.current?.modelKey ?? "Assistant";
            setMessages(previousMessages =>
              produce(previousMessages, draftMessages => {
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
              setPromptProcessingProgress(-1);
            } else if (progress !== promptProcessingProgress) {
              setPromptProcessingProgress(progress);
            }
          },
          onPredictionFragment(fragment) {
            if (fragment.isStructural) {
              return;
            }
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
            setMessages(previousMessages =>
              produce(previousMessages, draftMessages => {
                if (draftMessages.length === 0) {
                  return;
                }
                const lastMessageIndex = draftMessages.length - 1;
                const lastMessage = draftMessages[lastMessageIndex];
                if (lastMessage === undefined || lastMessage.type !== "assistant") {
                  return;
                }
                const targetPartType = fragment.reasoningType === "none" ? "response" : "reasoning";
                const parts = lastMessage.content;
                const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
                if (lastPart !== undefined && lastPart.type === targetPartType) {
                  lastPart.text += fragment.content;
                } else {
                  parts.push({
                    type: targetPartType,
                    text: fragment.content,
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
      } catch (error) {
        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
          if (errorMessage.includes("unload") || errorMessage.includes("not loaded")) {
            const currentModelKey = llmRef.current.modelKey;
            logErrorInChat(`${error.message}`);
            logInChat(`Would you like to reload the model?`);
            requestConfirmation({
              payload: {
                type: "reloadModel",
                originalInput: userInputState,
                modelKey: currentModelKey,
              },
              onConfirm: async payload => {
                if (payload.type !== "reloadModel") return;
                logInChat("Reloading model...");
                setModelLoadingProgress(0);
                try {
                  llmRef.current = await client.llm.model(payload.modelKey, {
                    verbose: false,
                    ttl,
                    onProgress(progress) {
                      setModelLoadingProgress(progress);
                    },
                  });
                  logInChat(`Model reloaded: ${llmRef.current.displayName}`);
                  setModelLoadingProgress(null);
                  setUserInputState(payload.originalInput);
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
      }
    }, [
      addMessage,
      client.llm,
      handleConfirmationResponse,
      handleExit,
      logErrorInChat,
      logInChat,
      promptProcessingProgress,
      requestConfirmation,
      normalizedSelectedSuggestionIndex,
      stats,
      suggestions,
      ttl,
      userInputState,
    ]);

    const renderSuggestions = useCallback(() => {
      if (suggestions.length === 0) {
        return null;
      }

      return (
        <ChatSuggestions
          suggestions={suggestions}
          selectedSuggestionIndex={normalizedSelectedSuggestionIndex}
          suggestionsPerPage={suggestionsPerPage}
        />
      );
    }, [normalizedSelectedSuggestionIndex, suggestions, suggestionsPerPage]);

    // We register slash commands once on mount and whenever they change.
    useEffect(() => {
      commandHandler.setCommands(slashCommands);
    }, [slashCommands]);

    return (
      <Box flexDirection="column" width={"95%"} flexWrap="wrap">
        <ChatMessagesList
          messages={messages}
          modelName={llmRef.current?.displayName ?? null}
          isPredicting={isPredicting}
          promptProcessingProgress={promptProcessingProgress}
        />
        {modelLoadingProgress !== null && (
          <Box paddingTop={1}>
            <Text color="yellow">Loading model... {Math.round(modelLoadingProgress * 100)}%</Text>
          </Box>
        )}
        <ChatInput
          inputState={userInputState}
          isPredicting={isPredicting}
          isConfirmationActive={isConfirmationActive}
          areSuggestionsVisible={areSuggestionsVisible}
          setUserInputState={setUserInputState}
          onSubmit={handleSubmit}
          onAbortPrediction={handleAbortPrediction}
          onExit={handleExit}
          onSuggestionsUp={handleSuggestionsUp}
          onSuggestionsDown={handleSuggestionsDown}
          onSuggestionsPageLeft={handleSuggestionsPageLeft}
          onSuggestionsPageRight={handleSuggestionsPageRight}
          onSuggestionAccept={handleSuggestionAccept}
          onPaste={handlePaste}
        />
        {renderSuggestions()}
      </Box>
    );
  },
);
