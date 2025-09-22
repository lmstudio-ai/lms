import type { SimpleLogger } from "@lmstudio/lms-common";
import { type Chat, type LLM, type LLMPredictionStats, type LMStudioClient } from "@lmstudio/sdk";
import { ProgressBar } from "../../ProgressBar.js";

export async function loadModelWithProgress(
  client: LMStudioClient,
  modelName: string,
  ttl: number,
  logger: SimpleLogger,
): Promise<LLM> {
  const progressBar = new ProgressBar();
  const abortController = new AbortController();
  const sigintListener = () => {
    progressBar.stop();
    abortController.abort();
    logger.warn("Load cancelled.");
    process.exit(1);
  };
  process.addListener("SIGINT", sigintListener);
  try {
    const llmModel = await client.llm.model(modelName, {
      verbose: false,
      onProgress: progress => {
        progressBar.setRatio(progress);
      },
      signal: abortController.signal,
      ttl,
    });
    return llmModel;
  } finally {
    process.removeListener("SIGINT", sigintListener);
    progressBar.stop();
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

export function displayVerboseStats(stats: LLMPredictionStats, logger: SimpleLogger) {
  logger.info("\n\nPrediction Stats:");
  logger.info(`  Stop Reason: ${stats.stopReason}`);
  if (stats.tokensPerSecond !== undefined) {
    logger.info(`  Tokens/Second: ${stats.tokensPerSecond.toFixed(2)}`);
  }
  if (stats.timeToFirstTokenSec !== undefined) {
    logger.info(`  Time to First Token: ${stats.timeToFirstTokenSec.toFixed(3)}s`);
  }
  if (stats.promptTokensCount !== undefined) {
    logger.info(`  Prompt Tokens: ${stats.promptTokensCount}`);
  }
  if (stats.predictedTokensCount !== undefined) {
    logger.info(`  Predicted Tokens: ${stats.predictedTokensCount}`);
  }
  if (stats.totalTokensCount !== undefined) {
    logger.info(`  Total Tokens: ${stats.totalTokensCount}`);
  }
}

/**
 * Executes an LLM prediction with streaming output and updates the chat history.
 * @returns Promise resolving to the prediction result and last fragment content
 */
export async function executePrediction(
  llmModel: LLM,
  chat: Chat,
  input: string,
  signal?: AbortSignal,
): Promise<{ result: any; lastFragment: string }> {
  chat.append("user", input);
  const prediction = llmModel.respond(chat, {
    signal: signal,
  });

  let lastFragment = "";
  for await (const fragment of prediction) {
    process.stdout.write(fragment.content);
    lastFragment = fragment.content;
  }

  const result = await prediction.result();
  chat.append("assistant", result.content);

  return { result, lastFragment };
}
