import { Static } from "ink";
import { memo } from "react";
import { ChatMessage } from "./ChatMessages.js";
import type { InkChatMessage } from "./types.js";

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

    const completedMessages =
      hasStreamingAssistantMessage === true ? messages.slice(0, -1) : messages;
    const streamingMessage =
      hasStreamingAssistantMessage === true ? messages[messages.length - 1] : null;

    return (
      <>
        <Static items={completedMessages}>
          {(message, index) => (
            <ChatMessage key={`static-${index}`} message={message} modelName={modelName} />
          )}
        </Static>
        {streamingMessage !== null && (
          <ChatMessage message={streamingMessage} modelName={modelName} />
        )}
      </>
    );
  },
);

ChatMessagesList.displayName = "ChatMessagesList";
