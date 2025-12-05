import { type LLM, type LMStudioClient, Chat } from "@lmstudio/sdk";
import { Box, Text, useApp } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatInput } from "./ChatInput.js";
import { ChatMessagesList } from "./ChatMessagesList.js";
import { ChatSuggestions } from "./ChatSuggestions.js";
import { SlashCommandHandler, type SlashCommand } from "./SlashCommandHandler.js";
import { insertPasteAtCursor, insertSuggestionAtCursor } from "./inputReducer.js";
import { useDownloadedModels, useSortedSuggestions, useSuggestionsPerPage } from "./hooks.js";
import { DEFAULT_SYSTEM_PROMPT } from "../index.js";
import type { ChatUserInputState, InkChatMessage, Suggestion } from "./types.js";
import { displayVerboseStats } from "../util.js";
import { PartialMessage } from "./PartialMessage.js";

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
}

const commandHandler = new SlashCommandHandler();

const emptyChatInputState: ChatUserInputState = {
  segments: [{ type: "text", content: "" }],
  cursorOnSegmentIndex: 0,
  cursorInSegmentOffset: 0,
};

export const ChatComponent = React.memo(
  ({ client, llm, chat, onExit, opts }: ChatComponentProps) => {
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
    const [confirmReload, setConfirmReload] = useState<{
      userInput: ChatUserInputState;
      modelKey: string;
    } | null>(null);
    const streamingContentRef = useRef("");
    const reasoningStreamingContentRef = useRef("");
    const promptProcessingProgressRef = useRef(-1);
    const abortControllerRef = useRef<AbortController | null>(opts?.abortController ?? null);
    const chatRef = useRef<Chat>(chat);
    const llmRef = useRef<LLM | null>(llm ?? null);
    const downloadedModels = useDownloadedModels(
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

    const logInChat = useCallback((logText: string) => {
      setMessages(previousMessages => [...previousMessages, { type: "log", content: logText }]);
    }, []);

    const logErrorInChat = useCallback((errorText: string) => {
      setMessages(previousMessages => [...previousMessages, { type: "error", content: errorText }]);
    }, []);

    const slashCommands = useMemo<SlashCommand[]>(() => {
      return [
        {
          name: "help",
          description: "Show help information",
          handler: async () => {
            const helpText = commandHandler.generateHelpText();
            setMessages(previousMessages => [
              ...previousMessages,
              { type: "help", content: helpText },
            ]);
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
              });
              logInChat(`Model loaded: ${llmRef.current.displayName}`);
            } catch (error) {
              logErrorInChat(`Failed to load model: ${(error as Error).message}`);
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
          handler: async commandArguments => {
            if (commandArguments.length === 0) {
              logInChat("Please specify a model to download. Type /model to see the list.");
              return;
            }
          },
          buildSuggestions: async ({ argsInput, fetchDownloadableModels }) => {
            const trimmedFilter = argsInput.trim();
            if (trimmedFilter.length === 0) {
              return [];
            }
            return await fetchDownloadableModels(trimmedFilter);
          },
        },
      ];
    }, [client.llm, commandHandler, exit, logErrorInChat, logInChat, onExit, opts?.ttl]);

    const fetchDownloadableModelSuggestions = useCallback(
      async (filterText: string) => {
        const trimmedFilter = filterText.trim();
        if (trimmedFilter.length === 0) {
          return [];
        }
        const availableModels = await client.repository.unstable.getModelCatalog();
        const lowercaseFilter = trimmedFilter.toLowerCase();
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
      [client],
    );

    // Input handling and rendering is delegated to ChatInput.

    const handleAbortPrediction = useCallback(() => {
      if (abortControllerRef.current !== null) {
        abortControllerRef.current.abort();
      }
      setIsPredicting(false);
    }, []);

    const handleExit = useCallback(() => {
      onExit();
      exit();
    }, [onExit, exit]);

    const handleSuggestionsUp = useCallback(() => {
      setSelectedSuggestionIndex(previousIndex => Math.max(0, previousIndex - 1));
    }, []);

    const handleSuggestionsDown = useCallback(() => {
      setSelectedSuggestionIndex(previousIndex =>
        Math.min(sortedSuggestions.length - 1, previousIndex + 1),
      );
    }, [sortedSuggestions.length]);

    const handleSuggestionsPageLeft = useCallback(() => {
      const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
      if (currentPage > 0) {
        const newIndex = (currentPage - 1) * suggestionsPerPage;
        setSelectedSuggestionIndex(newIndex);
      }
    }, [selectedSuggestionIndex, suggestionsPerPage]);

    const handleSuggestionsPageRight = useCallback(() => {
      const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
      const totalPages = Math.ceil(sortedSuggestions.length / suggestionsPerPage);
      if (currentPage < totalPages - 1) {
        const newIndex = (currentPage + 1) * suggestionsPerPage;
        setSelectedSuggestionIndex(newIndex);
      }
    }, [selectedSuggestionIndex, suggestionsPerPage, sortedSuggestions.length]);

    const handleSuggestionAccept = useCallback(() => {
      if (selectedSuggestionIndex === -1) {
        return;
      }
      const selectedSuggestion = sortedSuggestions[selectedSuggestionIndex];
      if (selectedSuggestion === undefined) {
        return;
      }
      switch (selectedSuggestion.type) {
        case "model": {
          const suggestionText = `/model ${selectedSuggestion.data.modelKey}`;
          setUserInputState(previousState =>
            insertSuggestionAtCursor({ state: previousState, suggestionText }),
          );
          setSuggestions([]);
          return;
        }
        case "command": {
          const suggestionText = `/${selectedSuggestion.data.name} `;
          setUserInputState(previousState =>
            insertSuggestionAtCursor({ state: previousState, suggestionText }),
          );
          setSuggestions([]);
          return;
        }
        case "downloadableModel": {
          const suggestionText = `/download ${selectedSuggestion.data.owner}/${selectedSuggestion.data.name}`;
          setUserInputState(previousState =>
            insertSuggestionAtCursor({ state: previousState, suggestionText }),
          );
          setSuggestions([]);
          return;
        }
        default: {
          const _exhaustiveCheck: never = selectedSuggestion;
          return _exhaustiveCheck;
        }
      }
    }, [selectedSuggestionIndex, sortedSuggestions]);

    const handlePaste = useCallback((content: string) => {
      const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      if (normalizedContent.length === 0) {
        return;
      }

      const LARGE_PASTE_THRESHOLD = 200;

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
      if (confirmReload !== null) {
        if (userInputText.toLowerCase() === "y" || userInputText.toLowerCase() === "yes") {
          const { userInput: originalInput, modelKey } = confirmReload;
          setConfirmReload(null);
          logInChat("Reloading model...");
          setModelLoadingProgress(0);
          try {
            llmRef.current = await client.llm.model(modelKey, {
              verbose: false,
              ttl: opts?.ttl,
              onProgress(progress) {
                setModelLoadingProgress(progress);
              },
            });
            logInChat(`Model reloaded: ${llmRef.current.displayName}`);
            setModelLoadingProgress(null);
            setUserInputState(originalInput);
            return;
          } catch (error) {
            setModelLoadingProgress(null);
            logErrorInChat(`Failed to reload model: ${(error as Error).message}`);
            return;
          }
        } else if (userInputText.toLowerCase() === "n" || userInputText.toLowerCase() === "no") {
          setConfirmReload(null);
          logInChat("Model reload cancelled.");
          handleExit();
          return;
        } else {
          logInChat("Please answer 'yes' or 'no'");
          return;
        }
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
        setMessages(previousMessages => [
          ...previousMessages,
          {
            type: "user",
            content: userInputState.segments.map(s => {
              if (s.type === "largePaste") {
                if (s.content.length > 50) {
                  return {
                    type: "largePaste",
                    text: `[Pasted ${s.content.slice(0, 50)}...]`,
                  };
                }
                return { type: s.type, text: s.content };
              }
              return { type: s.type, text: s.content };
            }),
          },
        ]);
        const result = await llmRef.current.respond(chatRef.current, {
          onPromptProcessingProgress(progress) {
            if (progress === 1) {
              promptProcessingProgressRef.current = -1;
            } else if (progress !== promptProcessingProgressRef.current) {
              promptProcessingProgressRef.current = progress;
            }
          },
          onPredictionFragment(fragment) {
            if (fragment.isStructural) {
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
            setMessages(previousMessages => [...previousMessages, assistantMessage]);
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
            setConfirmReload({ userInput: userInputState, modelKey: currentModelKey });
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
      client,
      commandHandler,
      confirmReload,
      handleExit,
      logErrorInChat,
      logInChat,
      opts?.stats,
      opts?.ttl,
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

    useEffect(() => {
      commandHandler.setCommands(slashCommands);
    }, [commandHandler, slashCommands]);

    useEffect(() => {
      let isCancelled = false;
      const updateSuggestions = async () => {
        const nextSuggestions = await commandHandler.getSuggestions({
          input: lastSegmentInputSegment,
          isPredicting,
          isConfirmReloadActive: confirmReload !== null,
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
      commandHandler,
      confirmReload,
      fetchDownloadableModelSuggestions,
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
          <Box marginBottom={1}>
            <Text color="yellow">Loading model... {Math.round(modelLoadingProgress * 100)}%</Text>
          </Box>
        )}
        <ChatInput
          inputState={userInputState}
          isPredicting={isPredicting}
          isConfirmReloadActive={confirmReload !== null}
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
