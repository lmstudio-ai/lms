import { type Chat, type LLM, type LMStudioClient } from "@lmstudio/sdk";
import { Box, useApp } from "ink";
import React, { useCallback, useRef, useState } from "react";
import { displayVerboseStats } from "../util.js";
import { ChatInput } from "./ChatInput.js";
import { ChatMessagesList } from "./ChatMessagesList.js";
import { PartialMessage } from "./PartialMessage.js";
import { insertPasteAtCursor } from "./inputReducer.js";
import type { ChatUserInputState, InkChatMessage } from "./types.js";

export const LARGE_PASTE_THRESHOLD = 512; // Minimum characters to consider input as a paste

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
    const streamingContentRef = useRef("");
    const reasoningStreamingContentRef = useRef("");
    const promptProcessingProgressRef = useRef(-1);
    const abortControllerRef = useRef<AbortController | null>(
      opts?.abortController ?? new AbortController(),
    );
    const chatRef = useRef<Chat>(chat);
    const llmRef = useRef<LLM | null>(llm ?? null);

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
      if (userInputText.length === 0) {
        return;
      }

      if (userInputText === "exit" || userInputText === "quit") {
        handleExit();
        return;
      }

      if (llmRef.current === null) {
        logErrorInChat("No model loaded");
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
          onFirstToken() {
            chatRef.current.append("assistant", "");
          },
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
            chatRef.current.at(-1).appendText(fragment.content);
          },
          signal,
        });
        const assistantMessage: InkChatMessage = {
          type: "assistant",
          content: [],
          displayName: llmRef.current?.displayName ?? llmRef.current?.modelKey ?? "Assistant",
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
        if (opts?.stats === true) {
          displayVerboseStats(result.stats, logInChat);
        }
      } catch (error) {
        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
          if (errorMessage.includes("unload") || errorMessage.includes("not loaded")) {
            logErrorInChat(`${error.message}`);
            logInChat(`No model is currently loaded. Please load a model to continue.`);
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
    }, [addMessage, handleExit, logErrorInChat, logInChat, opts?.stats, userInputState]);

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

        <ChatInput
          inputState={userInputState}
          isPredicting={isPredicting}
          setUserInputState={setUserInputState}
          onSubmit={handleSubmit}
          onAbortPrediction={handleAbortPrediction}
          onExit={handleExit}
          onPaste={handlePaste}
        />
      </Box>
    );
  },
);
