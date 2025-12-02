import { useState, useRef, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import { type LLM, type LMStudioClient, Chat } from "@lmstudio/sdk";
import { SlashCommandHandler } from "./SlashCommandHandler.js";
import { useModels, useSortedSuggestions, useSuggestionsPerPage } from "./hooks.js";
import { displayVerboseStats, trimNewlines } from "./util.js";
import type { ChatInputSegment, ChatUserInputState, InkChatMessage, Suggestion } from "./types.js";
import { DEFAULT_SYSTEM_PROMPT } from "./index.js";
import { ChatInput } from "./ChatInput.js";
import { ChatSuggestions } from "./ChatSuggestions.js";
import { produce } from "@lmstudio/immer-with-plugins";

interface ChatComponentProps {
  client: LMStudioClient;
  llm: LLM;
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

export const ChatComponent = ({ client, llm, chat, onExit, opts }: ChatComponentProps) => {
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
  const abortControllerRef = useRef<AbortController | null>(opts?.abortController ?? null);
  const chatRef = useRef<Chat>(chat);
  const llmRef = useRef<LLM>(llm);
  const models = useModels(client, llmRef.current.identifier);
  const sortedSuggestions = useSortedSuggestions(suggestions);
  const suggestionsPerPage = useSuggestionsPerPage(messages);
  const areSuggestionsVisible = sortedSuggestions.length > 0;
  const modelName = llmRef.current.displayName;
  const lastSegment = [...userInputState.segments]
    .reverse()
    .find(segment => segment.type === "text");

  const lastSegmentInputSegment = lastSegment?.content ?? "";
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
/exit - Exit the chat
/model [model_key] - Load a model (type /model to see list)
/clear - Clear the chat history
/system-prompt [prompt] - Set the system prompt
/help - Show this help information
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
        setUserInputState(emptyChatInputState);
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
    const input = lastSegmentInputSegment;
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
  }, [lastSegmentInputSegment, isPredicting, client, models, confirmReload]);

  // Input handling and rendering is delegated to ChatInput.

  const handleAbortPrediction = () => {
    if (abortControllerRef.current !== null) {
      abortControllerRef.current.abort();
    }
    setIsPredicting(false);
  };

  const handleExit = () => {
    onExit();
    exit();
  };

  const handleSuggestionsUp = () => {
    setSelectedSuggestionIndex(previousIndex => Math.max(0, previousIndex - 1));
  };

  const handleSuggestionsDown = () => {
    setSelectedSuggestionIndex(previousIndex =>
      Math.min(sortedSuggestions.length - 1, previousIndex + 1),
    );
  };

  const handleSuggestionsPageLeft = () => {
    const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
    if (currentPage > 0) {
      const newIndex = (currentPage - 1) * suggestionsPerPage;
      setSelectedSuggestionIndex(newIndex);
    }
  };

  const handleSuggestionsPageRight = () => {
    const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
    const totalPages = Math.ceil(sortedSuggestions.length / suggestionsPerPage);
    if (currentPage < totalPages - 1) {
      const newIndex = (currentPage + 1) * suggestionsPerPage;
      setSelectedSuggestionIndex(newIndex);
    }
  };

  const handleSuggestionAccept = () => {
    if (selectedSuggestionIndex === -1) {
      return;
    }
    const selectedSuggestion = sortedSuggestions[selectedSuggestionIndex];
    if (selectedSuggestion === undefined) {
      return;
    }
    if (selectedSuggestion.type === "model") {
      const suggestionText = `/model ${selectedSuggestion.data.modelKey}`;
      setUserInputState(previousState => {
        const newSegments: ChatInputSegment[] = [...previousState.segments];
        const lastSegmentIndex = newSegments.length - 1;
        const lastSegment = newSegments[lastSegmentIndex];
        if (lastSegment.type === "text") {
          newSegments[lastSegmentIndex] = {
            type: "text",
            content: suggestionText,
          };
        } else {
          newSegments.push({
            type: "text",
            content: suggestionText,
          });
        }
        return {
          segments: newSegments,
          cursorOnSegmentIndex: newSegments.length - 1,
          cursorInSegmentOffset: suggestionText.length,
        };
      });
      setSuggestions([]);
      return;
    }
    if (selectedSuggestion.type === "command") {
      const suggestionText = `/${selectedSuggestion.data.name} `;
      setUserInputState(previousState => {
        const newSegments: ChatInputSegment[] = [...previousState.segments];
        const lastSegmentIndex = newSegments.length - 1;
        const lastSegment = newSegments[lastSegmentIndex];
        if (lastSegment.type === "text") {
          newSegments[lastSegmentIndex] = {
            type: "text",
            content: suggestionText,
          };
        } else {
          newSegments.push({
            type: "text",
            content: suggestionText,
          });
        }
        return {
          segments: newSegments,
          cursorOnSegmentIndex: newSegments.length - 1,
          cursorInSegmentOffset: suggestionText.length,
        };
      });
      setSuggestions([]);
      return;
    }
  };

  const handlePaste = (content: string) => {
    const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    if (normalizedContent.length === 0) {
      return;
    }

    const LARGE_PASTE_THRESHOLD = 200;
    const isLargePaste = normalizedContent.length >= LARGE_PASTE_THRESHOLD;

    setUserInputState(
      produce(draft => {
        const segment = draft.segments[draft.cursorOnSegmentIndex];

        if (segment.type === "largePaste") {
          const largePasteIndex = draft.cursorOnSegmentIndex;
          const insertIndex =
            draft.cursorInSegmentOffset === 0 ? largePasteIndex : largePasteIndex + 1;

          draft.segments.splice(insertIndex, 0, {
            type: isLargePaste === true ? "largePaste" : "text",
            content: normalizedContent,
          });
          draft.cursorOnSegmentIndex = insertIndex;
          draft.cursorInSegmentOffset = normalizedContent.length;
        } else if (segment.type === "text") {
          if (isLargePaste === true) {
            const cursorPos = draft.cursorInSegmentOffset;
            const before = segment.content.slice(0, cursorPos);
            const after = segment.content.slice(cursorPos);

            segment.content = before;
            draft.segments.splice(
              draft.cursorOnSegmentIndex + 1,
              0,
              { type: "largePaste", content: normalizedContent },
              { type: "text", content: after },
            );
            draft.cursorOnSegmentIndex = draft.cursorOnSegmentIndex + 1;
            draft.cursorInSegmentOffset = normalizedContent.length;
          } else {
            const cursorPos = draft.cursorInSegmentOffset;
            segment.content =
              segment.content.slice(0, cursorPos) +
              normalizedContent +
              segment.content.slice(cursorPos);
            draft.cursorInSegmentOffset = cursorPos + normalizedContent.length;
          }
        }
      }),
    );
  };

  const handleSubmit = async () => {
    // Collect the full text input from the userInputState
    const input = userInputState.segments.reduce((acc, segment) => {
      if (segment.type === "text") {
        return acc + segment.content;
      } else if (segment.type === "largePaste") {
        const showPastedPreview = segment.content.length > 50;
        if (showPastedPreview) {
          return acc + segment.content.slice(0, 50) + "...";
        }
        return acc + segment.content;
      }
      return acc;
    }, "");
    const userInputText = input.trim();
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
      const { command, args } = SlashCommandHandler.parseSlashCommand(
        userInputText,
        sortedSuggestions[selectedSuggestionIndex],
      );
      if (command === null) {
        return;
      }
      const result = await commandHandler.execute(command, args);
      if (result === false) {
        logInChat(`Unknown command: ${userInputText}`);
      }
      return;
    }

    if (userInputText === "exit" || userInputText === "quit") {
      handleExit();
      return;
    }

    setIsPredicting(true);
    streamingContentRef.current = "";
    reasoningStreamingContentRef.current = "";
    if (abortControllerRef.current === null || abortControllerRef.current.signal.aborted === true) {
      abortControllerRef.current = new AbortController();
    }
    const signal = abortControllerRef.current.signal;

    try {
      chatRef.current.append("user", userInputText);
      setMessages(previousMessages => [
        ...previousMessages,
        { type: "user", content: userInputText },
      ]);
      const result = await llmRef.current.respond(chatRef.current, {
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
  };

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
      case "welcome":
        return (
          <Box marginBottom={1} marginLeft={1} flexDirection="column">
            <Box paddingX={1} borderStyle={"round"} borderColor={"magenta"} flexDirection="column">
              <Text color={"gray"}>👾 lms chat v0.42 </Text>
              <Text>
                Chatting with {modelName}. Type <Text bold>exit</Text> or Ctrl+C to quit.
              </Text>
              <Box marginTop={1} flexDirection="column">
                <Text color={"gray"}>Try one of the following commands:</Text>
                <Text color="gray">/help - Show help information</Text>
                <Text color={"gray"}>
                  /model [model_key] - Load a model (type /model to see list)
                </Text>
                <Text color="gray">/clear - Clear the chat history</Text>
              </Box>
            </Box>
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

    return (
      <ChatSuggestions
        suggestions={sortedSuggestions}
        selectedSuggestionIndex={selectedSuggestionIndex}
        suggestionsPerPage={suggestionsPerPage}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          Debug:{" "}
          {JSON.stringify({
            ...userInputState,
            segments: userInputState.segments.map(segment =>
              segment.type === "largePaste"
                ? { type: "largePaste", content: "[content hidden]" }
                : segment,
            ),
          })}
        </Text>
      </Box>
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
};
