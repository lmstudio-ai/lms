import { type LLM, type LMStudioClient, Chat } from "@lmstudio/sdk";
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
  useSortedSuggestions,
  useSuggestionHandlers,
  useSuggestionsPerPage,
} from "./hooks.js";
import { DEFAULT_SYSTEM_PROMPT } from "../index.js";
import type { ChatUserInputState, InkChatMessage, Suggestion } from "./types.js";
import { displayVerboseStats } from "../util.js";
import { PartialMessage } from "./PartialMessage.js";
import { fetchModelCatalog } from "../catalogHelpers.js";

interface ChatComponentProps {
  client: LMStudioClient;
  llm?: LLM;
  chat: Chat;
  onExit: () => void;
  opts?: {
    stats?: true;
    ttl: number;
    abortController?: AbortController;
  };
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
  ({ client, llm, chat, onExit, opts, shouldFetchModelCatalog }: ChatComponentProps) => {
    const { exit } = useApp();
    const [messages, setMessages] = useState<InkChatMessage[]>([
      {
        type: "welcome",
      },
    ]);

    const [userInputState, setUserInputState] = useState<ChatUserInputState>(emptyChatInputState);
    const [isPredicting, setIsPredicting] = useState(false);
    const [, setRenderTrigger] = useState(0);
    const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const { isConfirmationActive, requestConfirmation, handleConfirmationResponse } =
      useConfirmationPrompt<ChatConfirmationPayload>();
    const streamingContentRef = useRef("");
    const reasoningStreamingContentRef = useRef("");
    const promptProcessingProgressRef = useRef(-1);
    const abortControllerRef = useRef<AbortController | null>(
      opts?.abortController ?? new AbortController(),
    );
    const chatRef = useRef<Chat>(chat);
    const llmRef = useRef<LLM | null>(llm ?? null);
    const { downloadedModels, refreshDownloadedModels } = useDownloadedModels(
      client,
      llmRef.current !== null ? llmRef.current.identifier : null,
    );
    const sortedSuggestions = useSortedSuggestions(suggestions);
    const suggestionsPerPage = useSuggestionsPerPage(messages);
    const areSuggestionsVisible = useMemo(() => sortedSuggestions.length > 0, [sortedSuggestions]);
    const lastSegmentInputSegment = useMemo(() => {
      const lastSegment = [...userInputState.segments]
        .reverse()
        .find(segment => segment.type === "text");
      return lastSegment?.content ?? "";
    }, [userInputState.segments]);

    const addMessage = useCallback((message: InkChatMessage) => {
      let index = -1;
      setMessages(previousMessages => {
        index = previousMessages.length;
        return [...previousMessages, message];
      });
      return index;
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
      selectedSuggestionIndex,
      setSelectedSuggestionIndex,
      sortedSuggestions,
      suggestionsPerPage,
      setUserInputState,
      setSuggestions,
    });
    const slashCommands = useMemo<SlashCommand[]>(() => {
      return [
        {
          name: "help",
          description: "Show help information",
          handler: async () => {
            const helpText = commandHandler.generateHelpText();
            addMessage({ type: "help", content: helpText });
          },
        },
        {
          name: "exit",
          description: "Exit the chat",
          handler: async () => {
            onExit();
            exit();
          },
        },
        {
          name: "model",
          description: "Load a model (type /model to see list)",
          handler: async commandArguments => {
            if (commandArguments.length === 0) {
              logInChat("Please specify a model to load. Type /model to see the list.");
              return;
            }

            const modelKey = commandArguments.join(" ");

            if (llmRef.current !== null && modelKey === llmRef.current.modelKey) {
              return;
            }

            setModelLoadingProgress(0);
            try {
              llmRef.current = await client.llm.model(modelKey, {
                verbose: false,
                ttl: opts?.ttl,
                onProgress(progress) {
                  setModelLoadingProgress(progress);
                },
                signal: abortControllerRef.current?.signal,
              });
              logInChat(`Model Selected: ${llmRef.current.displayName}`);
            } catch (error) {
              const errorMessage =
                error instanceof Error && error.message !== undefined
                  ? error.message
                  : String(error);
              logErrorInChat(`Failed to load model: ${errorMessage}`);
            } finally {
              setModelLoadingProgress(null);
            }
          },
          buildSuggestions: ({ argsInput, models }) => {
            const normalizedFilter = argsInput.trim().toLowerCase();
            const filteredModels = models.filter(model =>
              model.modelKey.toLowerCase().includes(normalizedFilter),
            );
            return filteredModels.map(model => ({ type: "model", data: model }));
          },
        },
        {
          name: "clear",
          description: "Clear the chat history",
          handler: async () => {
            setMessages([]);
            setUserInputState(emptyChatInputState);
            console.clear();
            chatRef.current = Chat.empty();
            chatRef.current.append("system", DEFAULT_SYSTEM_PROMPT);
          },
        },
        {
          name: "system-prompt",
          description: "Set the system prompt",
          handler: async commandArguments => {
            const prompt = commandArguments.join(" ");
            if (prompt.length === 0) {
              logInChat("Please provide a system prompt.");
              return;
            }

            const newChat = chatRef.current.asMutableCopy();
            newChat.append("system", prompt);
            logInChat("System prompt updated to: " + prompt);
            chatRef.current = newChat;
          },
        },
        {
          name: "download",
          description: "Download a model",
          handler: handleDownloadCommand,
          buildSuggestions: async ({ argsInput, fetchDownloadableModels }) => {
            const trimmedFilter = argsInput.trim();
            return await fetchDownloadableModels(trimmedFilter);
          },
        },
      ];
    }, [
      addMessage,
      client.llm,
      exit,
      handleDownloadCommand,
      logErrorInChat,
      logInChat,
      onExit,
      opts?.ttl,
    ]);

    const fetchDownloadableModelSuggestions = useCallback(
      async (filterText: string) => {
        if (shouldFetchModelCatalog !== true) {
          return [];
        }
        const trimmedFilter = filterText.trim();
        const availableModels = await fetchModelCatalog(client);
        const lowercaseFilter = trimmedFilter.toLowerCase();
        if (lowercaseFilter.length === 0) {
          return availableModels.map(model => ({
            type: "downloadableModel" as const,
            data: {
              owner: model.owner,
              name: model.name,
              downloads: model.downloads,
              likeCount: model.likeCount,
              staffPickedAt: model.staffPickedAt,
            },
          }));
        }
        const filteredModels = availableModels.filter(model =>
          `${model.owner}/${model.name}`.toLowerCase().includes(lowercaseFilter),
        );
        return filteredModels.map(model => ({
          type: "downloadableModel" as const,
          data: {
            owner: model.owner,
            name: model.name,
            downloads: model.downloads,
            likeCount: model.likeCount,
            staffPickedAt: model.staffPickedAt,
          },
        }));
      },
      [client, shouldFetchModelCatalog],
    );

    // Input handling and rendering is delegated to ChatInput.

    const handleAbortPrediction = useCallback(() => {
      // Add finalized message before clearing refs to prevent flicker
      if (
        streamingContentRef.current.length > 0 ||
        reasoningStreamingContentRef.current.length > 0
      ) {
        const assistantMessage: InkChatMessage = {
          type: "assistant",
          content: [],
          displayName: llmRef.current?.displayName ?? "Assistant",
          stoppedByUser: true,
        };
        if (reasoningStreamingContentRef.current.length > 0) {
          assistantMessage.content.push({
            type: "reasoning",
            text: reasoningStreamingContentRef.current,
          });
        }
        if (streamingContentRef.current.length > 0) {
          assistantMessage.content.push({
            type: "response",
            text: streamingContentRef.current,
          });
        }
        addMessage(assistantMessage);
        streamingContentRef.current = "";
        reasoningStreamingContentRef.current = "";
      } else {
        logInChat("Prediction aborted by user.");
      }

      if (abortControllerRef.current !== null) {
        abortControllerRef.current.abort();
      }
      setIsPredicting(false);
    }, [addMessage, logInChat]);

    const handleExit = useCallback(() => {
      onExit();
      exit();
      process.exit(0);
    }, [onExit, exit]);

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

      if (userInputText.startsWith("/")) {
        const { command, argumentsText } = SlashCommandHandler.parseSlashCommand(
          userInputText,
          sortedSuggestions[selectedSuggestionIndex],
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
      streamingContentRef.current = "";
      reasoningStreamingContentRef.current = "";
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
          content: userInputState.segments.map(s => {
            if (s.type === "largePaste") {
              if (s.content.length > 50) {
                return {
                  type: "largePaste",
                  text: `[Pasted ${s.content.replace(/\r\n|\r|\n/g, "").slice(0, 50)}...]`,
                };
              }
              return { type: s.type, text: s.content };
            }
            return { type: s.type, text: s.content };
          }),
        });
        const result = await llmRef.current.respond(chatRef.current, {
          onPromptProcessingProgress(progress) {
            if (signal.aborted) {
              return;
            }
            if (progress === 1) {
              promptProcessingProgressRef.current = -1;
            } else if (progress !== promptProcessingProgressRef.current) {
              promptProcessingProgressRef.current = progress;
            }
            setRenderTrigger(previousTrigger => previousTrigger + 1);
          },
          onPredictionFragment(fragment) {
            if (fragment.isStructural) {
              return;
            }
            if (signal.aborted) {
              return;
            }
            if (fragment.reasoningType === "none") {
              streamingContentRef.current += fragment.content;
              setRenderTrigger(previousTrigger => previousTrigger + 1);
            } else if (
              fragment.reasoningType === "reasoningStartTag" ||
              fragment.reasoningType === "reasoningEndTag"
            ) {
              // Ignore reasoning tags
            } else {
              reasoningStreamingContentRef.current += fragment.content;
              setRenderTrigger(previousTrigger => previousTrigger + 1);
            }
          },
          onMessage(message) {
            const assistantMessage: InkChatMessage = {
              type: "assistant",
              content: [],
              displayName: llmRef.current?.displayName ?? "Assistant",
              stoppedByUser: signal.aborted,
            };
            if (signal.aborted) {
              return;
            }
            if (reasoningStreamingContentRef.current.length > 0) {
              assistantMessage.content.push({
                type: "reasoning",
                text: reasoningStreamingContentRef.current,
              });
            }
            if (streamingContentRef.current.length > 0) {
              assistantMessage.content.push({
                type: "response",
                text: streamingContentRef.current,
              });
            }
            addMessage(assistantMessage);
            streamingContentRef.current = "";
            reasoningStreamingContentRef.current = "";
            chatRef.current.append(message);
          },
          signal,
        });
        if (opts?.stats === true) {
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
                    ttl: opts?.ttl,
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
        abortControllerRef.current = null;
        reasoningStreamingContentRef.current = "";
        streamingContentRef.current = "";
      }
    }, [
      addMessage,
      client.llm,
      handleConfirmationResponse,
      handleExit,
      logErrorInChat,
      logInChat,
      opts?.stats,
      opts?.ttl,
      requestConfirmation,
      selectedSuggestionIndex,
      sortedSuggestions,
      userInputState,
    ]);

    const renderSuggestions = useCallback(() => {
      if (sortedSuggestions.length === 0) {
        return null;
      }

      return (
        <ChatSuggestions
          suggestions={sortedSuggestions}
          selectedSuggestionIndex={selectedSuggestionIndex}
          suggestionsPerPage={suggestionsPerPage}
        />
      );
    }, [sortedSuggestions, selectedSuggestionIndex, suggestionsPerPage]);

    // We register slash commands once on mount and whenever they change.
    useEffect(() => {
      commandHandler.setCommands(slashCommands);
    }, [slashCommands]);

    // Whenever a user inputs something which could be a command, we fetch suggestions.
    useEffect(() => {
      let isCancelled = false;
      const updateSuggestions = async () => {
        const nextSuggestions = await commandHandler.getSuggestions({
          input: lastSegmentInputSegment,
          isPredicting,
          isConfirmationActive,
          models: downloadedModels,
          fetchDownloadableModels: fetchDownloadableModelSuggestions,
        });

        if (isCancelled === true) {
          return;
        }
        setSuggestions(nextSuggestions);
        setSelectedSuggestionIndex(nextSuggestions.length > 0 ? 0 : -1);
      };

      updateSuggestions();

      return () => {
        isCancelled = true;
      };
    }, [
      fetchDownloadableModelSuggestions,
      isConfirmationActive,
      isPredicting,
      lastSegmentInputSegment,
      downloadedModels,
    ]);

    return (
      <Box flexDirection="column" width={"95%"} flexWrap="wrap">
        <ChatMessagesList messages={messages} modelName={llmRef.current?.displayName ?? null} />
        {isPredicting &&
          llmRef.current !== undefined &&
          llmRef.current?.displayName !== undefined && (
            <PartialMessage
              modelName={llmRef.current?.displayName}
              reasoningContent={reasoningStreamingContentRef.current}
              streamingContent={streamingContentRef.current}
              promptProcessingProgress={promptProcessingProgressRef.current}
            />
          )}
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
