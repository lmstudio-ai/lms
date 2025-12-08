import { memo } from "react";
import { Box, Text } from "ink";
import chalk from "chalk";
import type { InkChatMessage } from "./types.js";
import { trimNewlines } from "../util.js";

interface ChatMessageProps {
  message: InkChatMessage;
  modelName: string | null;
}

export const ChatMessage = memo(({ message, modelName }: ChatMessageProps) => {
  const type = message.type;
  switch (type) {
    case "user": {
      const formattedContent = message.content
        .map(part => {
          const text = trimNewlines(part.text);
          return part.type === "largePaste" && part.text.length > 50 ? chalk.blue(text) : text;
        })
        .join("");

      return (
        <Box paddingTop={1} flexDirection="row" flexWrap="nowrap" width={"100%"}>
          <Text color={"cyan"}>You: </Text>
          <Text wrap="wrap">{formattedContent}</Text>
        </Box>
      );
    }

    case "assistant":
      return (
        <Box flexDirection="column" width={"100%"}>
          <Text color="magenta">{message.displayName}:</Text>
          {message.content.map((part, partIndex) => (
            <Box key={partIndex}>
              <Text color={part.type === "reasoning" ? "gray" : undefined}>
                {trimNewlines(part.text)}
              </Text>
            </Box>
          ))}
          {message.stoppedByUser && (
            <Box>
              <Text color="red" wrap="truncate">
                [Response stopped by user]
              </Text>
            </Box>
          )}
        </Box>
      );
    case "help":
      return (
        <Box paddingTop={1} flexDirection="column" width={"95%"}>
          <Text color="green">Help:</Text>
          <Text>{trimNewlines(message.content)}</Text>
        </Box>
      );
    case "log":
      return (
        <Box paddingTop={1} flexDirection="column" width={"95%"}>
          <Text color="yellow">{trimNewlines(message.content)}</Text>
        </Box>
      );
    case "error":
      return (
        <Box paddingTop={1} flexDirection="column" width={"95%"}>
          <Text color="red">{trimNewlines(message.content)}</Text>
        </Box>
      );
    case "welcome":
      return (
        <Box paddingTop={1} marginLeft={1} flexDirection="column" minWidth={"50%"}>
          <Box paddingX={1} borderStyle={"round"} borderColor={"magenta"} flexDirection="column">
            <Text color={"gray"}>👾 lms chat v0.42 </Text>
            <Text>
              {modelName === null ? "Load a model using /model. " : `Chatting with ${modelName}. `}
              Type <Text bold>exit</Text> or Ctrl+C to quit.
            </Text>
            <Box paddingTop={1} flexDirection="column">
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
