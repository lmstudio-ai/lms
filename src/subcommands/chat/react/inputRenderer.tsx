import { Text } from "ink";
import { type JSX } from "react";

interface PasteRange {
  start: number;
  end: number;
}

interface RenderInputWithCursorOpts {
  fullText: string;
  cursorPosition: number;
  pasteRanges: PasteRange[];
  lineStartPos: number;
}

export function renderInputWithCursor({
  fullText,
  cursorPosition,
  pasteRanges,
  lineStartPos,
}: RenderInputWithCursorOpts): JSX.Element {
  const parts: JSX.Element[] = [];

  if (cursorPosition === -1) {
    // No cursor on this line
    const textParts = renderTextWithPasteColor({
      text: fullText,
      startPos: lineStartPos,
      pasteRanges,
      keyPrefix: "line",
    });
    parts.push(...textParts);
    return <>{parts}</>;
  }

  if (cursorPosition > 0) {
    const beforeText = fullText.slice(0, cursorPosition);
    const beforeParts = renderTextWithPasteColor({
      text: beforeText,
      startPos: lineStartPos,
      pasteRanges,
      keyPrefix: "before",
    });
    parts.push(...beforeParts);
  }

  const cursorChar = cursorPosition < fullText.length ? fullText[cursorPosition] : " ";
  parts.push(
    <Text key="cursor" inverse>
      {cursorChar}
    </Text>,
  );

  if (cursorPosition + 1 < fullText.length) {
    const afterText = fullText.slice(cursorPosition + 1);
    const afterParts = renderTextWithPasteColor({
      text: afterText,
      startPos: lineStartPos + cursorPosition + 1,
      pasteRanges,
      keyPrefix: "after",
    });
    parts.push(...afterParts);
  }

  return <>{parts}</>;
}

interface RenderTextWithPasteColorOpts {
  text: string;
  startPos: number;
  pasteRanges: PasteRange[];
  keyPrefix: string;
}

function renderTextWithPasteColor({
  text,
  startPos,
  pasteRanges,
  keyPrefix,
}: RenderTextWithPasteColorOpts): JSX.Element[] {
  if (text.length === 0) {
    return [];
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
        <Text key={`${keyPrefix}-${currentPos}`} color="blue">
          {pasteText}
        </Text>,
      );
      currentPos = relativeEnd;
    } else {
      const nextPaste = pasteRanges.find(range => range.start > absolutePos);
      const endPos =
        nextPaste !== undefined ? Math.min(nextPaste.start - startPos, text.length) : text.length;
      const normalText = text.slice(currentPos, endPos);
      parts.push(<Text key={`${keyPrefix}-${currentPos}`}>{normalText}</Text>);
      currentPos = endPos;
    }
  }

  return parts;
}
