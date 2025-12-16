import { memo } from "react";
import { Box, Text } from "ink";
import chalk from "chalk";
import type { InkChatMessage } from "./types.js";
import { trimNewlines } from "../util.js";
import { getVersion } from "../../version.js";

interface ChatMessageProps {
  message: InkChatMessage;
  modelName: string | null;
}

export const ChatMessage = memo(({ message, modelName }: ChatMessageProps) => {
  const type = message.type;
  switch (type) {
    case "user": {
      const formattedContent = message.content
        .map(contentPart => {
          const text = trimNewlines(contentPart.text);
          return contentPart.type === "largePaste" && contentPart.text.length > 50
            ? chalk.blue(text)
            : text;
        })
        .join("");

      return (
        <Box paddingTop={1} flexDirection="row" flexWrap="nowrap" width={"100%"}>
          <Text color="cyan">› </Text>
          <Text wrap="wrap">{formattedContent}</Text>
        </Box>
      );
    }

    case "assistant": {
      return (
        <Box flexDirection="column" width={"100%"}>
          {message.content.map((contentPart, contentIndex) => (
            <Box key={contentIndex}>
              <Text color={contentPart.type === "reasoning" ? "gray" : undefined}>
                {trimNewlines(contentPart.text)}
              </Text>
            </Box>
          ))}
          {message.stoppedByUser === true && (
            <Box>
              <Text color="red" wrap="truncate">
                [Response stopped by user]
              </Text>
            </Box>
          )}
        </Box>
      );
    }
    case "help":
      return (
        <Box paddingTop={1} flexDirection="column">
          <Text color="green">Help:</Text>
          <Text>{trimNewlines(message.content)}</Text>
        </Box>
      );
    case "log":
      return (
        <Box paddingTop={1} flexDirection="column">
          <Text>{trimNewlines(message.content)}</Text>
        </Box>
      );
    case "error":
      return (
        <Box paddingTop={1} flexDirection="column">
          <Text color="red">{trimNewlines(message.content)}</Text>
        </Box>
      );
    case "welcome":
      return (
        <Box paddingTop={1} marginLeft={1} flexDirection="column" minWidth={"50%"}>
          <Box paddingX={1} borderStyle={"round"} borderColor={"magenta"} flexDirection="column">
            <Text color={"gray"}>👾 lms chat {getVersion()} </Text>
            <Text>
              {modelName === null ? "Load a model using /model. " : `Chatting with ${modelName}. `}
              Type <Text bold>exit</Text> or Ctrl+C to quit.
            </Text>
            <Box paddingTop={1} flexDirection="column">
              <Text color={"gray"}>Try one of the following commands:</Text>
              <Text color="gray">/help - Show help information</Text>
              {modelName === null ? (
                <Text color={"gray"}>/download - Download a model</Text>
              ) : (
                <Text color={"gray"}>/model - Load a model (type /model to see list)</Text>
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
