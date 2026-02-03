import { Transform } from "ink";
import { type JSX } from "react";
import chalk from "chalk";

interface RenderInputWithCursorOpts {
  fullText: string;
  cursorPosition: number;
  chipRanges: Array<{ start: number; end: number; kind: "largePaste" | "image" }>;
  lineStartPos: number;
}

export function renderInputWithCursor({
  fullText,
  cursorPosition,
  chipRanges,
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
            const range = chipRanges.find(
              highlight => absolutePos >= highlight.start && absolutePos < highlight.end,
            );
            if (range?.kind === "largePaste") {
              result += chalk.blue(char);
            } else if (range?.kind === "image") {
              result += chalk.cyan(char);
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
