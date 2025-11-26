import React, { useState, useRef, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { type LLM, type LMStudioClient, Chat } from "@lmstudio/sdk";
import type { SimpleLogger } from "@lmstudio/lms-common";
import { type SlashCommand, SlashCommandHandler } from "./SlashCommandHandler.js";
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
      role: "user";
      content: string;
    }
  | {
      role: "assistant";
      content: Array<{
        type: "reasoning" | "response";
        text: string;
      }>;
    };
export function trimNewlines(input: string): string {
  return input.replace(/^[\r\n]+|[\r\n]+$/g, "");
}

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
  const [commandSuggestions, setCommandSuggestions] = useState<SlashCommand[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const modelName = llmRef.current.displayName;

  useEffect(() => {
    // Setup slash command handler
    commandHandler.register({
      name: "help",
      description: "Show help information",
      handler: async () => {
        // No ops for now
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
      description: "Show the current model name",
      handler: async args => {
        if (args[0] !== undefined) {
          llmRef.current = await client.llm.load(args[0]);
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
      name: "clay",
      description: "Test command",
      handler: async () => {
        setMessages([]);
        chatRef.current = Chat.empty();
        chatRef.current.append("system", DEFAULT_SYSTEM_PROMPT);
      },
    });
  }, [exit, onExit, client]);

  useEffect(() => {
    if (input.startsWith("/") && !isPredicting) {
      const commandPart = input.slice(1).toLowerCase();
      const filtered = commandHandler
        .list()
        .filter(cmd => cmd.name.toLowerCase().startsWith(commandPart));
      setCommandSuggestions(filtered);
      setSelectedSuggestionIndex(0);
    } else {
      setCommandSuggestions([]);
    }
  }, [input, isPredicting]);

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

    if (commandSuggestions.length > 0) {
      if (key.upArrow) {
        setSelectedSuggestionIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedSuggestionIndex(prev => Math.min(commandSuggestions.length - 1, prev + 1));
        return;
      }
      if (key.tab) {
        setInput(`/${commandSuggestions[selectedSuggestionIndex].name} `);
        setCommandSuggestions([]);
        return;
      }
    }

    if (key.return) {
      const userInput = input.trim();
      if (userInput.startsWith("/")) {
        setCommandSuggestions([]);
        const result = await commandHandler.execute(
          commandSuggestions[selectedSuggestionIndex]?.name ?? userInput.slice(1),
        );
        if (!result) {
          console.info(`Unknown command: ${userInput}`);
        }
        setInput("");
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
          { role: "user", content: userInput },
        ]);
        await llmRef.current.act(chatRef.current, [], {
          onPredictionFragment(fragment) {
            if (fragment.reasoningType === "none") {
              streamingContentRef.current += fragment.content;
              setRenderTrigger(prev => prev + 1);
            } else if (
              fragment.reasoningType === "reasoningStartTag" ||
              fragment.reasoningType === "reasoningEndTag"
            ) {
              // Ignore reasoning tags for display
            } else if (fragment.isStructural === false) {
              reasoningStreamingContentRef.current += fragment.content;
              setRenderTrigger(prev => prev + 1);
            }
          },

          onMessage(message) {
            const assistantMessage: InkChatMessage = {
              role: "assistant",
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

  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Box key={index} flexDirection="column" marginBottom={1}>
          {message.role === "user" ? (
            <Box flexDirection="row">
              <Text color="cyan">You: </Text>
              <Text>{trimNewlines(message.content)}</Text>
            </Box>
          ) : (
            <Box marginBottom={1} flexDirection="column">
              <Text color="magenta">{modelName}:</Text>
              {message.content.map((part, partIndex) => (
                <Text key={partIndex} color={part.type === "reasoning" ? "gray" : undefined}>
                  {trimNewlines(part.text)}
                </Text>
              ))}
            </Box>
          )}
        </Box>
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
      <Box>
        <Text color="cyan">› </Text>
        <Text>{input}</Text>

        {isPredicting && <Text color="gray"> (predicting...)</Text>}
      </Box>
      <Box>
        {commandSuggestions.length > 0 && (
          <Box flexDirection="column" marginLeft={2}>
            {commandSuggestions.map(cmd => (
              <Box key={cmd.name}>
                <Text
                  color={
                    selectedSuggestionIndex === commandSuggestions.indexOf(cmd)
                      ? "green"
                      : undefined
                  }
                >
                  /{cmd.name} - {cmd.description}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};
