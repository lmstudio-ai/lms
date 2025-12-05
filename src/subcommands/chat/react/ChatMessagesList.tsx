import { memo } from "react";
import { Box } from "ink";
import type { InkChatMessage } from "./types.js";
import { ChatMessage } from "./ChatMessages.js";

interface ChatMessagesListProps {
  messages: InkChatMessage[];
  modelName: string | null;
}

export const ChatMessagesList = memo(({ messages, modelName }: ChatMessagesListProps) => {
  return (
    <>
      {messages.map((message, index) => (
        <Box key={index}>
          <ChatMessage message={message} modelName={modelName} />
        </Box>
      ))}
    </>
  );
});

ChatMessagesList.displayName = "ChatMessagesList";
