import { type JSX, memo } from "react";
import { Box, Static } from "ink";
import type { InkChatMessage } from "./types.js";
import { ChatMessage } from "./ChatMessages.js";

interface ChatMessagesListProps {
  messages: InkChatMessage[];
  modelName: string | null;
  isPredicting: boolean;
}

export const ChatMessagesList = memo(
  ({ messages, modelName, isPredicting }: ChatMessagesListProps) => {
    const hasStreamingAssistantMessage =
      isPredicting === true &&
      messages.length > 0 &&
      messages[messages.length - 1]?.type === "assistant";

    const staticMessages = hasStreamingAssistantMessage === true ? messages.slice(0, -1) : messages;
    const streamingMessage =
      hasStreamingAssistantMessage === true ? messages[messages.length - 1] : null;

    const staticItems = staticMessages.map((message, index) => (
      <ChatMessage key={`static-${index}`} message={message} modelName={modelName} />
    ));
    const pendingItems =
      streamingMessage !== null ? (
        <ChatMessage message={streamingMessage} modelName={modelName} isStreaming />
      ) : null;

    return (
      <>
        <Static items={staticItems}>{item => item}</Static>
        {pendingItems}
      </>
    );
  },
);

ChatMessagesList.displayName = "ChatMessagesList";
