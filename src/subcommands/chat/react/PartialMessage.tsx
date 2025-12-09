import { memo } from "react";
import { Box, Text } from "ink";
import { trimNewlines } from "../util.js";
import { Spinner } from "./Spinner.js";

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
      <Box flexDirection="column" width={"98%"}>
        <Box>
          <Text color="magenta">{modelName}:</Text>
          {promptProcessingProgress > 0 && <Spinner />}
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
