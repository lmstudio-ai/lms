import { Box, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { type ChatUserInputState } from "./types.js";

interface ChatInputProps {
  inputState: ChatUserInputState;
  isPredicting: boolean;
  setUserInputState: Dispatch<SetStateAction<ChatUserInputState>>;
  onSubmit: () => void;
  onAbortPrediction: () => void;
  onExit: () => void;
}

export const ChatInput = ({
  inputState,
  isPredicting,
  setUserInputState,
  onSubmit,
  onAbortPrediction,
  onExit,
}: ChatInputProps) => {
  const [cursorPosition, setCursorPosition] = useState(0);

  useEffect(() => {
    if (cursorPosition > inputState.length) {
      setCursorPosition(inputState.length);
    }
  }, [inputState.length, cursorPosition]);

  useInput((inputCharacter, key) => {
    if (key.ctrl === true && inputCharacter === "c") {
      if (isPredicting) {
        onAbortPrediction();
      } else {
        onExit();
      }
      return;
    }

    if (isPredicting) {
      return;
    }

    if (key.backspace === true || key.delete === true) {
      if (cursorPosition > 0) {
        const before = inputState.slice(0, cursorPosition - 1);
        const after = inputState.slice(cursorPosition);
        setUserInputState(before + after);
        setCursorPosition(cursorPosition - 1);
      }
      return;
    }

    if (key.leftArrow === true) {
      if (cursorPosition > 0) {
        setCursorPosition(cursorPosition - 1);
      }
      return;
    }

    if (key.rightArrow === true) {
      if (cursorPosition < inputState.length) {
        setCursorPosition(cursorPosition + 1);
      }
      return;
    }

    if (key.return === true) {
      onSubmit();
      setCursorPosition(0);
      return;
    }

    if (
      key.ctrl !== true &&
      key.meta !== true &&
      inputCharacter !== undefined &&
      inputCharacter.length > 0
    ) {
      const before = inputState.slice(0, cursorPosition);
      const after = inputState.slice(cursorPosition);
      setUserInputState(before + inputCharacter + after);
      setCursorPosition(cursorPosition + inputCharacter.length);
    }
  });

  const renderInputWithCursor = () => {
    if (inputState.length === 0) {
      return (
        <>
          <Text inverse>T</Text>
          <Text>ype a message</Text>
        </>
      );
    }

    const before = inputState.slice(0, cursorPosition);
    const cursorChar = cursorPosition < inputState.length ? inputState[cursorPosition] : " ";
    const after = inputState.slice(cursorPosition + 1);

    return (
      <>
        {before.length > 0 && <Text>{before}</Text>}
        <Text inverse>{cursorChar}</Text>
        {after.length > 0 && <Text>{after}</Text>}
      </>
    );
  };

  return (
    <Box flexDirection="column" width="100%" paddingTop={1}>
      <Box>
        <Text color="cyan">› </Text>
        {isPredicting ? <Text color="gray">Generating response...</Text> : renderInputWithCursor()}
      </Box>
    </Box>
  );
};
