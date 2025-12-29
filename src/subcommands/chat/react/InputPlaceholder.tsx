import { Box, Text } from "ink";
import { Spinner } from "./Spinner.js";

interface InputPlaceholderOpts {
  isPredicting: boolean;
  modelLoadingProgress: number | null;
  promptProcessingProgress: number | null;
  fetchingModelDetails: { owner: string; name: string } | null;
  downloadProgress: { owner: string; name: string; progress: number } | null;
  predictionSpinnerVisible: boolean;
}

export function InputPlaceholder({
  isPredicting,
  modelLoadingProgress,
  promptProcessingProgress,
  fetchingModelDetails,
  downloadProgress,
  predictionSpinnerVisible,
}: InputPlaceholderOpts) {
  if (fetchingModelDetails !== null) {
    return (
      <Box>
        <Text dimColor>
          Fetching model details for {fetchingModelDetails.owner}/{fetchingModelDetails.name}{" "}
        </Text>
        <Spinner />
      </Box>
    );
  }

  if (downloadProgress !== null) {
    return (
      <Box>
        <Text color="cyan">› </Text>
        <Text dimColor>
          Downloading {downloadProgress.owner}/{downloadProgress.name}...{" "}
          {Math.round(downloadProgress.progress * 100)}%
        </Text>
      </Box>
    );
  }

  if (modelLoadingProgress !== null) {
    return (
      <Box>
        <Text color="cyan">› </Text>
        <Text dimColor>Loading model... {Math.round(modelLoadingProgress * 100)}%</Text>
      </Box>
    );
  }

  if (promptProcessingProgress !== null && promptProcessingProgress > 0) {
    return (
      <Box>
        <Text color="cyan">› </Text>
        <Text dimColor>Processing prompt... {Math.round(promptProcessingProgress * 100)}% </Text>
        <Spinner />
      </Box>
    );
  }

  if (isPredicting) {
    if (predictionSpinnerVisible) {
      return <Spinner />;
    }
    return <Text color="cyan">› </Text>;
  }

  return (
    <Box>
      <Text color="cyan">› </Text>
      <Text inverse>T</Text>
      <Text dimColor>ype a message or use / to use commands</Text>
    </Box>
  );
}
