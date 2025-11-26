import React, { useState, useRef, useEffect, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { type LLM, type LMStudioClient, Chat, text } from "@lmstudio/sdk";
import type { SimpleLogger } from "@lmstudio/lms-common";
import { type SlashCommand, SlashCommandHandler } from "./SlashCommandHandler.js";
import { log } from "../log.js";
export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. Provide clear and concise answers to the user's questions. If you don't know the answer, admit it honestly.`;
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

type InkChatMessage =
  | {
      type: "user";
      content: string;
    }
  | {
      type: "assistant";
      content: Array<{
        type: "reasoning" | "response";
        text: string;
      }>;
    }
  | {
      type: "help";
      content: string;
    }
  | {
      type: "log";
      content: string;
    };

type Suggestion =
  | { type: "command"; data: SlashCommand }
  | { type: "model"; data: { modelKey: string; isLoaded: boolean; isCurrent: boolean } };

export function trimNewlines(input: string): string {
  return input.replace(/^[\r\n]+|[\r\n]+$/g, "");
}
const SUGGESTIONS_PER_PAGE = 12;
const commandHandler = new SlashCommandHandler();

export const ChatComponent = ({ client, llm, chat, logger, onExit, opts }: ChatComponentProps) => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<InkChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isPredicting, setIsPredicting] = useState(false);
  const streamingContentRef = useRef("");
  const reasoningStreamingContentRef = useRef("");
  const abortControllerRef = useRef<AbortController | null>(opts?.abortController ?? null);
  const [, setRenderTrigger] = useState(0);
  const chatRef = useRef<Chat>(chat);
  const llmRef = useRef<LLM>(llm);
  const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const sortedSuggestions = useMemo(() => {
    return [...suggestions].sort((a, b) => {
      if (a.type === "model" && b.type === "model") {
        if (a.data.isCurrent && !b.data.isCurrent) return -1;
        if (!a.data.isCurrent && b.data.isCurrent) return 1;
        if (a.data.isLoaded && !b.data.isLoaded) return -1;
        if (!a.data.isLoaded && b.data.isLoaded) return 1;
        return a.data.modelKey.localeCompare(b.data.modelKey);
      }
      if (a.type === "model" && b.type === "command") {
        return -1;
      }
      if (a.type === "command" && b.type === "model") {
        return 1;
      }
      if (a.type === "command" && b.type === "command") {
        return a.data.name.localeCompare(b.data.name);
      }
      return 0;
    });
  }, [suggestions]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const modelName = llmRef.current.displayName;
  const [downloadedModels, setDownloadedModels] = useState<
    Array<{ modelKey: string; isLoaded: boolean; isCurrent: boolean }>
  >([]);

  useEffect(() => {
    const fetchModels = async () => {
      const dm = await client.system.listDownloadedModels();
      const lm = await client.llm.listLoaded();
      const currentModelIdentifier = llmRef.current.identifier;
      const models = dm.map(model => {
        const loadedCount = lm.filter(loadedModel => loadedModel.path === model.path).length;
        const isCurrent = lm.some(
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
  }, [client]);

  const logInChat = (logText: string) => {
    setMessages(previousMessages => [...previousMessages, { type: "log", content: logText }]);
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
/model [model_path] - Load a model (type /model to see list)
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
        const modelPath = args.join(" ");
        setModelLoadingProgress(0);
        try {
          llmRef.current = await client.llm.load(modelPath, {
            verbose: false,
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
        // Copy existing user and assistant messages and replace system prompt(s)
        // with the new prompt

        const newChat = Chat.empty();
        newChat.append("system", prompt);
        for (const message of chatRef.current.getMessagesArray()) {
          if (message.getRole() === "system") continue;
          newChat.append(message);
        }
        chatRef.current = newChat;
      },
    });
  }, [exit, onExit, client]);

  useEffect(() => {
    if (input.startsWith("/") && !isPredicting) {
      const commandPart = input.slice(1).toLowerCase();

      // Check if typing /model with space - show model list
      if (input === "/model " || input.startsWith("/model ")) {
        const modelFilter = input.slice(7).toLowerCase();
        const filtered = downloadedModels.filter(model =>
          model.modelKey.toLowerCase().includes(modelFilter),
        );
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
  }, [input, isPredicting, client, downloadedModels]);

  useInput(async (inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      if (isPredicting) {
        abortControllerRef.current?.abort();
        setIsPredicting(false);
      } else {
        onExit();
        exit();
      }
      return;
    }

    if (isPredicting) return;

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
        const currentPage = Math.floor(selectedSuggestionIndex / SUGGESTIONS_PER_PAGE);
        if (currentPage > 0) {
          const newIndex = (currentPage - 1) * SUGGESTIONS_PER_PAGE;
          setSelectedSuggestionIndex(newIndex);
        }
        return;
      }
      if (key.rightArrow) {
        const currentPage = Math.floor(selectedSuggestionIndex / SUGGESTIONS_PER_PAGE);
        const totalPages = Math.ceil(sortedSuggestions.length / SUGGESTIONS_PER_PAGE);
        if (currentPage < totalPages - 1) {
          const newIndex = (currentPage + 1) * SUGGESTIONS_PER_PAGE;
          setSelectedSuggestionIndex(newIndex);
        }
        return;
      }

      if (selectedSuggestionIndex !== -1 && key.tab) {
        const selectedSuggestion = sortedSuggestions[selectedSuggestionIndex];
        if (selectedSuggestion.type === "model") {
          {
            setSuggestions([]);
            setInput("");
            return;
          }
        } else if (selectedSuggestion.type === "command") {
          setInput(`/${selectedSuggestion.data.name} `);
          setSuggestions([]);
          return;
        }
      }
    }

    if (key.return) {
      const userInput = input.trim();
      if (userInput.startsWith("/")) {
        const selectedSuggestion = sortedSuggestions[selectedSuggestionIndex];
        setSuggestions([]);
        const commandName =
          selectedSuggestion?.type === "command"
            ? selectedSuggestion.data.name
            : selectedSuggestion?.type === "model"
              ? "model"
              : userInput.slice(1);
        let args = userInput
          .slice(commandName.length + 1)
          .trim()
          .split(" ")
          .filter(arg => arg.length > 0);
        // Check if suggestion for model is selected
        // If so, use that model
        // Otherwise, use typed command
        if (selectedSuggestion?.type === "model") {
          const model = selectedSuggestion.data;
          args = [model.modelKey];
        }

        setInput("");
        const result = await commandHandler.execute(
          commandName + (args.length > 0 ? " " + args.join(" ") : ""),
        );
        if (!result) {
          logInChat(`Unknown command: ${userInput}`);
        }
        return;
      }
      setInput("");

      if (userInput === "exit" || userInput === "quit") {
        onExit();
        exit();
        return;
      }

      if (userInput.length === 0) {
        return;
      }

      // In useInput, before setIsPredicting
      if (await commandHandler.execute(userInput)) {
        return;
      }

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
        await llmRef.current.act(chatRef.current, [], {
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
      } catch (error) {
        // Handle prediction errors
        logger.error(`Prediction error: ${(error as Error).message}`);
      } finally {
        setIsPredicting(false);
        abortControllerRef.current = null;
        reasoningStreamingContentRef.current = "";
        streamingContentRef.current = "";
      }
    } else if (key.backspace || key.delete) {
      setInput(previousInput => previousInput.slice(0, -1));
    } else if (!key.ctrl && !key.meta && inputChar) {
      setInput(previousInput => previousInput + inputChar);
    }
  });
  function renderMessage(message: InkChatMessage, index: number) {
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
            <Text color="magenta">{modelName}:</Text>
            {(message.content as Array<{ type: string; text: string }>).map((part, partIndex) => (
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

    if (selectedSuggestionIndex === -1) {
      setSelectedSuggestionIndex(0);
    }

    const totalPages = Math.ceil(sortedSuggestions.length / SUGGESTIONS_PER_PAGE);
    const currentPage = Math.floor(selectedSuggestionIndex / SUGGESTIONS_PER_PAGE);
    const startIndex = currentPage * SUGGESTIONS_PER_PAGE;
    const endIndex = Math.min(startIndex + SUGGESTIONS_PER_PAGE, sortedSuggestions.length);
    const visibleSuggestions = sortedSuggestions.slice(startIndex, endIndex);

    function renderSuggestion(suggestion: Suggestion, index: number) {
      const globalIndex = startIndex + index;
      if (suggestion.type === "command") {
        return (
          <Box key={suggestion.data.name}>
            <Text backgroundColor={selectedSuggestionIndex === globalIndex ? "gray" : undefined}>
              /{suggestion.data.name} - {suggestion.data.description}
            </Text>
          </Box>
        );
      } else {
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
        <Box key={index}>{renderMessage(message, index)}</Box>
      ))}
      {isPredicting && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="magenta">{modelName}:</Text>
          <Text color="gray">(predicting...)</Text>
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
        <Text color="cyan">› </Text>
        <Text>{input}</Text>
      </Box>
      {renderSuggestions()}
    </Box>
  );
};
