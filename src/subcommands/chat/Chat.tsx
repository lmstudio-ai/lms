import { useState, useRef, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { type LLM, type LMStudioClient, Chat } from "@lmstudio/sdk";
import type { SimpleLogger } from "@lmstudio/lms-common";
import { SlashCommandHandler } from "./SlashCommandHandler.js";
import { useModels, useSortedSuggestions, useSuggestionsPerPage } from "./hooks.js";
import { displayVerboseStats, trimNewlines } from "./util.js";
import type { InkChatMessage, Suggestion } from "./types.js";
import { DEFAULT_SYSTEM_PROMPT } from "./index.js";

interface ChatComponentProps {
  client: LMStudioClient;
  llm: LLM;
  chat: Chat;
  logger: SimpleLogger;
  onExit: () => void;
  opts?: {
    stats?: true;
    ttl: number;
    abortController?: AbortController;
  };
}

const commandHandler = new SlashCommandHandler();

export const ChatComponent = ({ client, llm, chat, logger, onExit, opts }: ChatComponentProps) => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<InkChatMessage[]>([]);

  const [input, setInput] = useState("");
  const [isPredicting, setIsPredicting] = useState(false);
  const [, setRenderTrigger] = useState(0);
  const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [confirmReload, setConfirmReload] = useState<{
    userInput: string;
    modelKey: string;
  } | null>(null);
  const streamingContentRef = useRef("");
  const reasoningStreamingContentRef = useRef("");
  const abortControllerRef = useRef<AbortController | null>(opts?.abortController ?? null);
  const chatRef = useRef<Chat>(chat);
  const llmRef = useRef<LLM>(llm);
  const models = useModels(client, llmRef.current.identifier);
  const sortedSuggestions = useSortedSuggestions(suggestions);
  const suggestionsPerPage = useSuggestionsPerPage(messages);
  const modelName = llmRef.current.displayName;
  const logInChat = (logText: string) => {
    setMessages(previousMessages => [...previousMessages, { type: "log", content: logText }]);
  };
  const logErrorInChat = (errorText: string) => {
    setMessages(previousMessages => [...previousMessages, { type: "error", content: errorText }]);
  };

  useEffect(() => {
    // Setup slash command handler
    commandHandler.register({
      name: "help",
      description: "Show help information",
      handler: async () => {
        const helpText = `Available commands:
/help - Show this help information
/exit - Exit the chat
/model [model_key] - Load a model (type /model to see list)
/clear - Clear the chat history
/system-prompt [prompt] - Set the system prompt
`;
        setMessages(previousMessages => [...previousMessages, { type: "help", content: helpText }]);
      },
    });

    commandHandler.register({
      name: "exit",
      description: "Exit the chat",
      handler: async () => {
        onExit();
        exit();
      },
    });

    commandHandler.register({
      name: "model",
      description: "Load a model (type /model to see list)",
      handler: async args => {
        if (args.length === 0) {
          logInChat("Please specify a model to load. Type /model to see the list.");
          return;
        }

        const modelKey = args.join(" ");

        if (modelKey === llmRef.current.modelKey) {
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
          console.error(`Failed to load model: ${(error as Error).message}`);
        } finally {
          setModelLoadingProgress(null);
        }
      },
    });

    commandHandler.register({
      name: "clear",
      description: "Clear the chat history",
      handler: async () => {
        setMessages([]);
        setCursorPosition(0);
        setInput("");
        // We clear the entire chat and just use the default system prompt
        chatRef.current = Chat.empty();
        chatRef.current.append("system", DEFAULT_SYSTEM_PROMPT);
      },
    });

    commandHandler.register({
      name: "system-prompt",
      description: "Set the system prompt",
      handler: async args => {
        const prompt = args.join(" ");
        if (prompt.length === 0) {
          logInChat("Please provide a system prompt.");
          return;
        }

        const newChat = chatRef.current.asMutableCopy();
        newChat.append("system", prompt);
        logInChat("System prompt updated to: " + prompt);
        chatRef.current = newChat;
      },
    });
  }, [exit, onExit, client, opts?.ttl]);

  useEffect(() => {
    if (input.startsWith("/") && !isPredicting && confirmReload === null) {
      const commandPart = input.slice(1).toLowerCase();

      // Check if typing /model with space - show model list
      // only show models if input is exactly "/model " or starts with "/model " and has more text
      if (input.startsWith("/model ") && input.split(" ").length === 2) {
        const modelFilter = input.slice(6).trim().toLowerCase();
        const filtered = models.filter(model => model.modelKey.toLowerCase().includes(modelFilter));
        setSuggestions(filtered.map(model => ({ type: "model", data: model })));
        setSelectedSuggestionIndex(0);
      } else {
        const filtered = commandHandler
          .list()
          .filter(cmd => cmd.name.toLowerCase().startsWith(commandPart));
        setSuggestions(filtered.map(cmd => ({ type: "command", data: cmd })));
        setSelectedSuggestionIndex(0);
      }
    } else {
      setSuggestions([]);
    }
  }, [input, isPredicting, client, models]);

  useInput(async (inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      // Handle Ctrl+C
      if (isPredicting) {
        abortControllerRef.current?.abort();
        setIsPredicting(false);
      } else {
        onExit();
        exit();
      }
      return;
    }

    // If predicting, ignore all keys except Ctrl+C
    if (isPredicting) return;

    // Check if suggestions are visible
    if (suggestions.length > 0) {
      if (key.upArrow) {
        setSelectedSuggestionIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedSuggestionIndex(prev => Math.min(sortedSuggestions.length - 1, prev + 1));
        return;
      }
      if (key.leftArrow) {
        const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
        if (currentPage > 0) {
          const newIndex = (currentPage - 1) * suggestionsPerPage;
          setSelectedSuggestionIndex(newIndex);
        }
        return;
      }
      if (key.rightArrow) {
        const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
        const totalPages = Math.ceil(sortedSuggestions.length / suggestionsPerPage);
        if (currentPage < totalPages - 1) {
          const newIndex = (currentPage + 1) * suggestionsPerPage;
          setSelectedSuggestionIndex(newIndex);
        }
        return;
      }

      if (selectedSuggestionIndex !== -1 && key.tab) {
        const selectedSuggestion = sortedSuggestions[selectedSuggestionIndex];
        if (selectedSuggestion.type === "model") {
          {
            setInput(`/model ${selectedSuggestion.data.modelKey}`);
            setCursorPosition(selectedSuggestion.data.modelKey.length + 7);
            setSuggestions([]);
            return;
          }
        } else if (selectedSuggestion.type === "command") {
          setInput(`/${selectedSuggestion.data.name} `);
          setCursorPosition(selectedSuggestion.data.name.length + 2);
          setSuggestions([]);
          return;
        }
      }
    }
    if (key.leftArrow && suggestions.length === 0) {
      setCursorPosition(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow && suggestions.length === 0) {
      setCursorPosition(prev => Math.min(input.length, prev + 1));
      return;
    }
    if (key.return) {
      const userInput = input.trim();
      if (userInput.length === 0) {
        return;
      }

      setInput("");
      setCursorPosition(0);

      // Handle model reload confirmation
      if (confirmReload !== null) {
        if (userInput.toLowerCase() === "y" || userInput.toLowerCase() === "yes") {
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
            // Retry the original request
            setInput(originalInput);
            setCursorPosition(originalInput.length);
            return;
          } catch (error) {
            setModelLoadingProgress(null);
            logErrorInChat(`Failed to reload model: ${(error as Error).message}`);
            return;
          }
        } else if (userInput.toLowerCase() === "n" || userInput.toLowerCase() === "no") {
          setConfirmReload(null);
          logInChat("Model reload cancelled.");
          onExit();
          exit();
          return;
        } else {
          logInChat("Please answer 'yes' or 'no'");
          return;
        }
      }

      // Handle slash commands
      if (userInput.startsWith("/")) {
        const { command, args } = SlashCommandHandler.parseSlashCommand(
          userInput,
          sortedSuggestions[selectedSuggestionIndex],
        );
        if (command === null) {
          return;
        }
        const result = await commandHandler.execute(command, args);
        if (!result) {
          logInChat(`Unknown command: ${userInput}`);
        }
        return;
      }

      if (userInput === "exit" || userInput === "quit") {
        onExit();
        exit();
        return;
      }

      // Handle normal user input
      setIsPredicting(true);
      streamingContentRef.current = "";
      reasoningStreamingContentRef.current = "";
      if (!abortControllerRef.current || abortControllerRef.current.signal.aborted) {
        abortControllerRef.current = new AbortController();
      }
      const signal = abortControllerRef.current.signal;

      try {
        chatRef.current.append("user", userInput);
        setMessages(previousMessages => [
          ...previousMessages,
          { type: "user", content: userInput },
        ]);
        const result = await llmRef.current.respond(chatRef.current, {
          onPredictionFragment(fragment) {
            if (fragment.isStructural) return;
            if (fragment.reasoningType === "none") {
              streamingContentRef.current += fragment.content;
              setRenderTrigger(prev => prev + 1);
            } else if (
              fragment.reasoningType === "reasoningStartTag" ||
              fragment.reasoningType === "reasoningEndTag"
            ) {
              // Ignore reasoning tags for display
            } else {
              reasoningStreamingContentRef.current += fragment.content;
              setRenderTrigger(prev => prev + 1);
            }
          },

          onMessage(message) {
            const assistantMessage: InkChatMessage = {
              type: "assistant",
              content: [],
              displayName: modelName,
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
        // Handle prediction errors
        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
          if (errorMessage.includes("unload") || errorMessage.includes("not loaded")) {
            const currentModelKey = llmRef.current.modelKey;
            logErrorInChat(`${error.message}`);
            logInChat(`Would you like to reload the model?`);
            setConfirmReload({ userInput, modelKey: currentModelKey });
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
    } else if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        setInput(
          previousInput =>
            previousInput.slice(0, cursorPosition - 1) + previousInput.slice(cursorPosition),
        );
        setCursorPosition(prev => prev - 1);
      }
    } else if (!key.ctrl && !key.meta && inputChar) {
      setInput(
        previousInput =>
          previousInput.slice(0, cursorPosition) + inputChar + previousInput.slice(cursorPosition),
      );
      setCursorPosition(prev => prev + 1);
    }
  });

  function renderMessage(message: InkChatMessage) {
    const type = message.type;
    switch (type) {
      case "user":
        return (
          <Box flexDirection="row">
            <Text color="cyan">You: </Text>
            <Text>{trimNewlines(message.content)}</Text>
          </Box>
        );

      case "assistant":
        return (
          <Box marginBottom={1} flexDirection="column">
            <Text color="magenta">{message.displayName}:</Text>
            {message.content.map((part, partIndex) => (
              <Text key={partIndex} color={part.type === "reasoning" ? "gray" : undefined}>
                {trimNewlines(part.text)}
              </Text>
            ))}
          </Box>
        );

      case "help":
        return (
          <Box marginBottom={1} flexDirection="column">
            <Text color="green">Help:</Text>
            <Text>{trimNewlines(message.content)}</Text>
          </Box>
        );
      case "log":
        return (
          <Box marginBottom={1} flexDirection="column">
            <Text color="yellow">{trimNewlines(message.content)}</Text>
          </Box>
        );
      case "error":
        return (
          <Box marginBottom={1} flexDirection="column">
            <Text color="red">{trimNewlines(message.content)}</Text>
          </Box>
        );
      default: {
        const exhaustiveCheck: never = type;
        throw new Error(`Unhandled message type: ${exhaustiveCheck}`);
      }
    }
  }

  function renderSuggestions() {
    if (sortedSuggestions.length === 0) {
      return null;
    }
    // Sort all suggestions such that model loaded and current appear first
    // Then paginate
    const totalPages = Math.ceil(sortedSuggestions.length / suggestionsPerPage);
    const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
    const startIndex = currentPage * suggestionsPerPage;
    const endIndex = Math.min(startIndex + suggestionsPerPage, sortedSuggestions.length);
    const visibleSuggestions = sortedSuggestions.slice(startIndex, endIndex);

    function renderSuggestion(suggestion: Suggestion, index: number) {
      const globalIndex = startIndex + index;
      const suggestionType = suggestion.type;
      switch (suggestionType) {
        case "command": {
          return (
            <Box key={suggestion.data.name}>
              <Text backgroundColor={selectedSuggestionIndex === globalIndex ? "gray" : undefined}>
                /{suggestion.data.name} - {suggestion.data.description}
              </Text>
            </Box>
          );
        }
        case "model": {
          const model = suggestion.data;
          return (
            <Box key={model.modelKey}>
              <Text
                bold={model.isCurrent}
                backgroundColor={selectedSuggestionIndex === globalIndex ? "gray" : undefined}
              >
                {model.modelKey}
                {model.isLoaded ? " (loaded)" : model.isCurrent ? " (current)" : null}
              </Text>
            </Box>
          );
        }
        default: {
          const exhaustiveCheck: never = suggestionType;
          throw new Error(`Unhandled suggestion type: ${exhaustiveCheck}`);
        }
      }
    }

    return (
      <Box flexDirection="column" marginLeft={2}>
        {visibleSuggestions.map((suggestion, index) => renderSuggestion(suggestion, index))}
        {totalPages > 1 && (
          <Box marginTop={1}>
            <Text color="gray">
              {Array.from({ length: totalPages }, (_, pageIndex) =>
                pageIndex === currentPage ? "●" : "○",
              ).join(" ")}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Box key={index}>{renderMessage(message)}</Box>
      ))}
      {isPredicting && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="magenta">{modelName}:</Text>
          {reasoningStreamingContentRef.current.length > 0 && (
            <Text color="gray">{trimNewlines(reasoningStreamingContentRef.current)}</Text>
          )}
          {streamingContentRef.current.length > 0 && (
            <Text>{trimNewlines(streamingContentRef.current)}</Text>
          )}
        </Box>
      )}
      {modelLoadingProgress !== null && (
        <Box marginBottom={1}>
          <Text color="yellow">Loading model... {Math.round(modelLoadingProgress * 100)}%</Text>
        </Box>
      )}
      <Box>
        {confirmReload !== null && <Text color="cyan">(yes/no) </Text>}
        <Text color="cyan">› </Text>
        <Text>{input.slice(0, cursorPosition)}</Text>
        <Text inverse>{cursorPosition < input.length ? input[cursorPosition] : " "}</Text>
        <Text>{input.slice(cursorPosition + 1)}</Text>
      </Box>
      {renderSuggestions()}
    </Box>
  );
};
