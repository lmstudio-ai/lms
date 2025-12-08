import { memo } from "react";
import { Box, Static } from "ink";
import type { InkChatMessage } from "./types.js";
import { ChatMessage } from "./ChatMessages.js";

interface ChatMessagesListProps {
  messages: InkChatMessage[];
  modelName: string | null;
}

export const ChatMessagesList = memo(({ messages, modelName }: ChatMessagesListProps) => {
  return (
    <Box width={"98%"} flexDirection="column" flexWrap="wrap">
      <Static items={messages}>
        {(message, index) => <ChatMessage key={index} message={message} modelName={modelName} />}
      </Static>
    </Box>
  );
});

ChatMessagesList.displayName = "ChatMessagesList";
