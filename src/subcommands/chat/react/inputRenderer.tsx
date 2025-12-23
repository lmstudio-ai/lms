import { Transform } from "ink";
import { type JSX } from "react";
import chalk from "chalk";

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
  if (fullText.length === 0 && cursorPosition === 0) {
    return <>{chalk.inverse(" ")}</>;
  }

  return (
    <Transform
      key={`${fullText}-${cursorPosition}`}
      transform={output => {
        let result = "";
        for (let index = 0; index < output.length; index++) {
          const absolutePos = lineStartPos + index;
          const char = output[index];

          if (index === cursorPosition) {
            result += chalk.inverse(char);
          } else {
            const isInPasteRange = pasteRanges.some(
              range => absolutePos >= range.start && absolutePos < range.end,
            );
            if (isInPasteRange) {
              result += chalk.blue(char);
            } else {
              result += char;
            }
          }
        }
        if (cursorPosition === output.length) {
          result += chalk.inverse(" ");
        }

        return result;
      }}
    >
      {fullText}
    </Transform>
  );
}
