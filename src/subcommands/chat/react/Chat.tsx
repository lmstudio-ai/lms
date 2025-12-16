import { produce } from "@lmstudio/immer-with-plugins";
import { type Chat, type LLM, type LMStudioClient } from "@lmstudio/sdk";
import { Box, useApp } from "ink";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { displayVerboseStats } from "../util.js";
import { ChatInput } from "./ChatInput.js";
import { ChatMessagesList } from "./ChatMessagesList.js";
import { ChatSuggestions } from "./ChatSuggestions.js";
import { SlashCommandHandler } from "./SlashCommandHandler.js";
import {
  LARGE_PASTE_THRESHOLD,
  useConfirmationPrompt,
  useDownloadCommand,
  useDownloadedModels,
  useModelCatalog,
  useSuggestionHandlers,
  useSuggestionsPerPage,
} from "./hooks.js";
import { insertPasteAtCursor } from "./inputReducer.js";
import { createSlashCommands } from "./slashCommands.js";
import type { ChatUserInputState, InkChatMessage, Suggestion } from "./types.js";

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
    const [messages, setMessages] = useState<InkChatMessage[]>([
      {
        type: "welcome",
      },
    ]);

    const [userInputState, setUserInputState] = useState<ChatUserInputState>(emptyChatInputState);
    const [isPredicting, setIsPredicting] = useState(false);
    const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);
    const [fetchingModelDetails, setFetchingModelDetails] = useState<{
      owner: string;
      name: string;
    } | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<{
      owner: string;
      name: string;
      progress: number;
    } | null>(null);
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
      <Box flexDirection="column" width={"95%"} flexWrap="wrap">
        <ChatMessagesList
          messages={messages}
          modelName={llmRef.current?.displayName ?? null}
          isPredicting={isPredicting}
        />
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
