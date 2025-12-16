import { memo } from "react";
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

    return (
      <Box width={"98%"} flexDirection="column" flexWrap="wrap">
        <Static items={staticMessages}>
          {(message, index) => <ChatMessage key={index} message={message} modelName={modelName} />}
        </Static>
        {streamingMessage !== null && (
          <ChatMessage message={streamingMessage} modelName={modelName} />
        )}
      </Box>
    );
  },
);

ChatMessagesList.displayName = "ChatMessagesList";
