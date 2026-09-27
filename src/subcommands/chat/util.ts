import type { SimpleLogger } from "@lmstudio/lms-common";
import { type Chat, type LLM, type LLMPredictionStats, type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import { Spinner } from "../../Spinner.js";
import { t } from "../../i18n/index.js";
import { reasoningModeToPredictionOpts, type ReasoningMode } from "./reasoning.js";
import { type InkChatMessage } from "./react/types.js";

export async function loadModelWithProgress(
  client: LMStudioClient,
  modelName: string,
  ttl: number,
  logger: SimpleLogger,
): Promise<LLM> {
  const spinner = new Spinner(`Loading ${modelName}`);
  const abortController = new AbortController();
  let lastProgressUpdateTime = 0;
  const updateSpinnerProgress = (progress: number) => {
    const now = Date.now();
    if (progress < 1 && now - lastProgressUpdateTime < 100) {
      return;
    }
    spinner.setText(t(`Loading {p0} {p1}%`, { p0: modelName, p1: (progress * 100).toFixed(0) }));
    lastProgressUpdateTime = now;
  };

  const sigintListener = () => {
    spinner.stop();
    abortController.abort();
    logger.warn(t("Load cancelled."));
    process.exit(1);
  };

  process.addListener("SIGINT", sigintListener);
  try {
    const llmModel = await client.llm.model(modelName, {
      verbose: false,
      signal: abortController.signal,
      ttl,
      onProgress: updateSpinnerProgress,
    });
    return llmModel;
  } finally {
    process.removeListener("SIGINT", sigintListener);
    spinner.stop();
  }
}

export async function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let input = "";
    process.stdin.setEncoding("utf-8");

    process.stdin.on("data", chunk => {
      input += chunk;
    });

    process.stdin.on("end", () => {
      resolve(input.trim());
    });
  });
}
export function displayVerboseStats(
  stats: LLMPredictionStats,
  logFunction: (text: string) => void,
) {
  let result = t("\n\nPrediction Stats:");
  result += t(`\n  Stop Reason: {p0}`, { p0: stats.stopReason });
  if (stats.tokensPerSecond !== undefined) {
    result += t(`\n  Tokens/Second: {p0}`, { p0: stats.tokensPerSecond.toFixed(2) });
  }
  if (stats.timeToFirstTokenSec !== undefined) {
    result += t(`\n  Time to First Token: {p0}s`, { p0: stats.timeToFirstTokenSec.toFixed(3) });
  }
  if (stats.promptTokensCount !== undefined) {
    result += t(`\n  Prompt Tokens: {p0}`, { p0: stats.promptTokensCount });
  }
  if (stats.predictedTokensCount !== undefined) {
    result += t(`\n  Predicted Tokens: {p0}`, { p0: stats.predictedTokensCount });
  }
  if (stats.totalTokensCount !== undefined) {
    result += t(`\n  Total Tokens: {p0}`, { p0: stats.totalTokensCount });
  }
  logFunction(result);
}

/**
 * Executes an LLM prediction with streaming output and updates the chat history.
 * @returns Promise resolving to the prediction result and last fragment content
 */
export async function executePrediction(
  llmModel: LLM,
  chat: Chat,
  input: string,
  controller?: AbortController,
  reasoningMode: ReasoningMode = "auto",
): Promise<{ result: any; lastFragment: string }> {
  chat.append("user", input);
  const prediction = llmModel.respond(chat, {
    ...reasoningModeToPredictionOpts(reasoningMode),
    signal: controller?.signal,
  });
  let lastFragment = "";
  for await (const fragment of prediction) {
    if (fragment.reasoningType === "reasoningStartTag") {
      process.stdout.write("<think>\n");
      continue;
    }
    if (fragment.reasoningType === "reasoningEndTag") {
      process.stdout.write("\n</think>\n");
      continue;
    }
    if (fragment.isStructural) {
      continue;
    }
    process.stdout.write(fragment.content);
    lastFragment = fragment.content;
  }

  if (controller?.signal.aborted === true) {
    process.stdout.write(chalk.dim(t("\nGeneration interrupted by user with Ctrl^C\n")));
  }

  const result = await prediction.result();
  chat.append("assistant", result.content);

  return { result, lastFragment };
}

/**
 * Removes leading and trailing newline characters from a string.
 * @param input - The string to trim newlines from
 * @returns The input string with leading and trailing newlines removed
 */
export function trimNewlines(input: string): string {
  return input.replace(/^[\r\n]+|[\r\n]+$/g, "");
}

/**
 * Removes leading newline characters from a string.
 * @param input - The string to trim newlines from
 * @returns The input string with leading newlines removed
 */
export function trimLeadingNewlines(input: string): string {
  return input.replace(/^[\r\n]+/g, "");
}

/**
 * Removes trailing newline characters from a string.
 * @param input - The string to trim newlines from
 * @returns The input string with trailing newlines removed
 */
export function trimTrailingNewlines(input: string): string {
  return input.replace(/[\r\n]+$/g, "");
}

const MAX_SCAN_FOR_PLACEHOLDER = 2000; // Just a reasonable limit to avoid excessive processing

export function getLargePastePlaceholderText(content: string, previewLength: number = 50): string {
  let previewCharsCount = 0;
  let truncated = false;
  let preview = "";
  let scanned = 0;

  for (const character of content) {
    if (scanned >= MAX_SCAN_FOR_PLACEHOLDER) {
      truncated = true;
      return t(`[Pasted {p0} characters...]`, { p0: content.length });
    }
    scanned++;

    if (character === "\n" || character === "\r") continue;

    if (previewCharsCount < previewLength) {
      preview += character;
      previewCharsCount++;
      continue;
    }

    truncated = true;
    break;
  }

  const ellipsis = truncated ? "..." : "";
  const spacer = preview.length > 0 ? " " : "";
  return t(`[Pasted{p0}{p1}{p2}]`, { p0: spacer, p1: preview, p2: ellipsis });
}

export const estimateMessageLinesCount = (message: InkChatMessage): number => {
  const terminalWidth = process.stdout.columns ?? 80;

  const countWrappedLines = (text: string, prefixLength: number = 0): number => {
    const effectiveWidth = terminalWidth - prefixLength;
    if (effectiveWidth <= 0) return 1;

    // Split by newlines first
    const textLines = text.split("\n");
    let totalLines = 0;

    for (const line of textLines) {
      // Each line wraps based on its length
      totalLines += Math.max(1, Math.ceil(line.length / effectiveWidth));
    }

    return Math.max(1, totalLines);
  };

  const type = message.type;
  switch (type) {
    case "user":
      return countWrappedLines(
        message.content.reduce((acc, a) => acc + a.text, ""),
        5,
      ); // "You: " prefix
    case "assistant": {
      let lines = 1; // displayName line
      message.content.forEach(part => {
        lines += countWrappedLines(part.text, 0);
      });
      return lines + 1; // marginBottom
    }
    case "help":
      return 1 + countWrappedLines(message.content, 0) + 1;
    case "log":
      return countWrappedLines(message.content, 0) + 1;
    case "error":
      return countWrappedLines(message.content, 0) + 1;
    case "welcome":
      return 10;
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown message type: ${exhaustiveCheck}`);
    }
  }
};

export function getOwnerNameFromModelName(
  modelName: string,
): { owner: string; name: string } | null {
  const parts = modelName.split("/");
  if (parts.length !== 2) {
    return null;
  }
  return {
    owner: parts[0],
    name: parts[1],
  };
}
