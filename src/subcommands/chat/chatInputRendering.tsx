import { Box, Text } from "ink";
import { type JSX } from "react";

interface PasteRange {
  start: number;
  end: number;
}

interface RenderInputLineOpts {
  lineText: string;
  lineIndex: number;
  terminalWidth: number;
  fullText: string;
  cursorPosition: number;
  pasteRanges: PasteRange[];
  isConfirmReloadActive: boolean;
}

export function renderInputLine({
  lineText,
  lineIndex,
  terminalWidth,
  fullText,
  cursorPosition,
  pasteRanges,
  isConfirmReloadActive,
}: RenderInputLineOpts): JSX.Element {
  const inputBeforeCursor = fullText.slice(0, cursorPosition);
  const cursorLineIndex =
    inputBeforeCursor.length === 0 ? 0 : inputBeforeCursor.split("\n").length - 1;
  const lastNewlineIndex = inputBeforeCursor.lastIndexOf("\n");
  const cursorColumnIndex =
    lastNewlineIndex === -1
      ? inputBeforeCursor.length
      : inputBeforeCursor.length - lastNewlineIndex - 1;

  const isCursorLine = lineIndex === cursorLineIndex;
  const shouldShowConfirmReloadPrefix = isConfirmReloadActive === true && lineIndex === 0;
  const promptPrefix = lineIndex === 0 ? "› " : "  ";
  const confirmReloadPrefix = shouldShowConfirmReloadPrefix === true ? "(yes/no) " : "";
  const visiblePrefixLength = (confirmReloadPrefix + promptPrefix).length;

  if (isCursorLine === false) {
    const lineContentLength = lineText.length;
    const paddingLength = Math.max(0, terminalWidth - visiblePrefixLength - lineContentLength);
    const padding = " ".repeat(paddingLength);

    const lineStartPos =
      fullText.split("\n").slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0);
    const textParts = renderTextWithPasteColor({
      text: lineText,
      startPos: lineStartPos,
      pasteRanges,
    });

    return (
      <Box key={lineIndex}>
        {shouldShowConfirmReloadPrefix === true && <Text color="cyan">(yes/no) </Text>}
        <Text color="cyan">{promptPrefix}</Text>
        {textParts}
        <Text>{padding}</Text>
      </Box>
    );
  }

  const hasCharacterAtCursor =
    cursorPosition < fullText.length && cursorColumnIndex < lineText.length;
  const cursorCharacter = hasCharacterAtCursor ? lineText[cursorColumnIndex] : " ";
  const beforeCursorText = lineText.slice(0, cursorColumnIndex);
  const afterCursorText =
    hasCharacterAtCursor && cursorColumnIndex + 1 <= lineText.length
      ? lineText.slice(cursorColumnIndex + 1)
      : "";
  const lineContentLength = beforeCursorText.length + 1 + afterCursorText.length;
  const paddingLength = Math.max(0, terminalWidth - visiblePrefixLength - lineContentLength);
  const padding = " ".repeat(paddingLength);

  const lineStartPos =
    fullText.split("\n").slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0);
  const beforeParts = renderTextWithPasteColor({
    text: beforeCursorText,
    startPos: lineStartPos,
    pasteRanges,
  });
  const afterParts = renderTextWithPasteColor({
    text: afterCursorText,
    startPos: lineStartPos + cursorColumnIndex + 1,
    pasteRanges,
  });

  return (
    <Box key={lineIndex}>
      {shouldShowConfirmReloadPrefix === true && <Text color="cyan">(yes/no) </Text>}
      <Text color="cyan">{promptPrefix}</Text>
      {beforeParts}
      <Text inverse>{cursorCharacter}</Text>
      {afterParts}
      <Text>{padding}</Text>
    </Box>
  );
}

interface RenderTextWithPasteColorOpts {
  text: string;
  startPos: number;
  pasteRanges: PasteRange[];
}

function renderTextWithPasteColor({
  text,
  startPos,
  pasteRanges,
}: RenderTextWithPasteColorOpts): JSX.Element | null {
  if (text.length === 0) {
    return null;
  }

  const parts: JSX.Element[] = [];
  let currentPos = 0;

  while (currentPos < text.length) {
    const absolutePos = startPos + currentPos;
    const pasteRange = pasteRanges.find(
      range => absolutePos >= range.start && absolutePos < range.end,
    );

    if (pasteRange !== undefined) {
      const relativeEnd = Math.min(pasteRange.end - startPos, text.length);
      const pasteText = text.slice(currentPos, relativeEnd);
      parts.push(
        <Text key={currentPos} color="blue">
          {pasteText}
        </Text>,
      );
      currentPos = relativeEnd;
    } else {
      const nextPaste = pasteRanges.find(range => range.start > absolutePos);
      const endPos =
        nextPaste !== undefined ? Math.min(nextPaste.start - startPos, text.length) : text.length;
      const normalText = text.slice(currentPos, endPos);
      parts.push(<Text key={currentPos}>{normalText}</Text>);
      currentPos = endPos;
    }
  }

  return <>{parts}</>;
}
