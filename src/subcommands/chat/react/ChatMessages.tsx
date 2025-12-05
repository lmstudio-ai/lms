import { memo } from "react";
import { Box, Text } from "ink";
import type { InkChatMessage } from "./types.js";
import { trimNewlines } from "../util.js";

interface ChatMessageProps {
  message: InkChatMessage;
  modelName: string | null;
}

export const ChatMessage = memo(({ message, modelName }: ChatMessageProps) => {
  const type = message.type;
  switch (type) {
    case "user":
      return (
        <Box flexDirection="row">
          <Text color="cyan">You: </Text>
          {message.content.map((part, partIndex) => (
            <Text
              key={partIndex}
              color={part.type === "largePaste" && part.text.length > 50 ? "blue" : undefined}
            >
              {trimNewlines(part.text)}
            </Text>
          ))}
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
              {modelName === null ? "Load a model using /model. " : `Chatting with ${modelName}. `}
              Type <Text bold>exit</Text> or Ctrl+C to quit.
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={"gray"}>Try one of the following commands:</Text>
              <Text color="gray">/help - Show help information</Text>
              {modelName === null ? (
                <Text color={"gray"}>/download [model_name] - Download a model</Text>
              ) : (
                <Text color={"gray"}>
                  /model [model_key] - Load a model (type /model to see list)
                </Text>
              )}
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
});

ChatMessage.displayName = "ChatMessage";
