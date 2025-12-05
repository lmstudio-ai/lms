import { memo } from "react";
import { Box, Text } from "ink";
import { trimNewlines } from "./util.js";

interface PartialMessageProps {
  modelName: string;
  reasoningContent: string;
  streamingContent: string;
  promptProcessingProgress: number;
}

export const PartialMessage = memo(
  ({
    modelName,
    reasoningContent,
    streamingContent,
    promptProcessingProgress,
  }: PartialMessageProps) => {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="magenta">{modelName}:</Text>
          {promptProcessingProgress > 0 && (
            <Text color="gray">{(promptProcessingProgress * 100).toFixed(2)}%</Text>
          )}
        </Box>
        <Box key={"reasoningContent"}>
          <Text color="gray">{trimNewlines(reasoningContent)}</Text>
        </Box>
        <Box key={"streamingContent"}>
          <Text>{trimNewlines(streamingContent)}</Text>
        </Box>
      </Box>
    );
  },
);

PartialMessage.displayName = "PartialMessage";
