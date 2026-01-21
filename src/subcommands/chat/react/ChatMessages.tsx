import { memo } from "react";
import { Box, Text } from "ink";
import chalk from "chalk";
import type { InkChatMessage } from "./types.js";
import { trimNewlines } from "../util.js";

interface ChatMessageProps {
  message: InkChatMessage;
  modelName: string | null;
  isStreaming?: boolean;
}

export const ChatMessage = memo(({ message, modelName, isStreaming = false }: ChatMessageProps) => {
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
      const assistantBackgroundColor = isStreaming ? "blue" : undefined;
      return (
        <Box flexDirection="column" width={"100%"}>
          {message.content.map((contentPart, contentIndex) => (
            <Box key={contentIndex}>
              <Text
                backgroundColor={assistantBackgroundColor}
                color={contentPart.type === "reasoning" ? "gray" : undefined}
              >
                {contentPart.text}
              </Text>
            </Box>
          ))}

          {message.stoppedByUser === true && (
            <Box>
              <Text color="red" wrap="truncate" backgroundColor={assistantBackgroundColor}>
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
            <Text dimColor>👾 lms chat</Text>
            <Text>
              Type <Text bold>exit</Text> or Ctrl+C to quit
            </Text>
            {modelName !== null && (
              <Box paddingTop={1}>
                <Text bold>{`Chatting with ${modelName}`}</Text>
              </Box>
            )}
            <Box paddingTop={1} flexDirection="column">
              <Text dimColor>Try one of the following commands:</Text>
              <Text dimColor>/model - Load a model (type /model to see list)</Text>
              <Text dimColor>/download - Download a model</Text>
              <Text dimColor>/clear - Clear the chat history</Text>
              <Text dimColor>/help - Show help information</Text>
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
