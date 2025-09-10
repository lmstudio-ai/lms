import type { SimpleLogger } from "@lmstudio/lms-common";
import { type Chat, type LMStudioClient, type LLM, type LLMPredictionStats } from "@lmstudio/sdk";
import { ProgressBar } from "./ProgressBar.js";
import * as readline from "readline";

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
  const llmModel = await client.llm.model(modelName, {
    verbose: false,
    onProgress: progress => {
      progressBar.setRatio(progress);
    },
    signal: abortController.signal,
    ttl,
  });
  process.removeListener("SIGINT", sigintListener);
  progressBar.stop();
  return llmModel;
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

export async function handlePromptResponse(
  llmModel: LLM,
  chat: Chat,
  prompt: string,
  options: { stats?: boolean },
  logger: SimpleLogger,
): Promise<void> {
  chat.append("user", prompt);
  try {
    const prediction = llmModel.respond(chat);
    let lastFragment = "";
    for await (const fragment of prediction) {
      process.stdout.write(fragment.content);
      lastFragment = fragment.content;
    }
    const result = await prediction.result();
    chat.append("assistant", result.content);

    if (options.stats !== undefined) {
      displayVerboseStats(result.stats, logger);
    }

    if (!lastFragment.endsWith("\n")) {
      // Newline before new shell prompt if not already there
      process.stdout.write("\n");
    }
    process.exit(0);
  } catch (err) {
    logger.error("Error during chat:", err);
    process.exit(1);
  }
}

async function runPrediction(
  llmModel: LLM,
  chat: Chat,
  input: string,
  logger: SimpleLogger,
  rl: readline.Interface,
  ttl: number,
  stats: true | undefined,
): Promise<void> {
  chat.append("user", input);
  process.stdout.write("\n● ");

  const prediction = llmModel.respond(chat);
  rl.pause();

  for await (const fragment of prediction) {
    process.stdout.write(fragment.content);
  }
  const result = await prediction.result();
  chat.append("assistant", result.content);

  if (stats !== undefined) {
    displayVerboseStats(result.stats, logger);
  }

  process.stdout.write("\n\n");
  rl.resume();
  rl.prompt();
}

export async function startInteractiveChat(
  client: LMStudioClient,
  llmModel: LLM,
  chat: Chat,
  logger: SimpleLogger,
  modelName: string,
  ttl: number,
  stats: true | undefined,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "› ",
  });

  process.stdout.write("\n");
  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (input === "exit" || input === "quit") {
      rl.close();
      return;
    }

    // Skip empty input
    if (!input) {
      rl.prompt();
      return;
    }

    try {
      await runPrediction(llmModel, chat, input, logger, rl, ttl, stats);
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes("unloaded") === true) {
        const answer = await new Promise<string>(resolve => {
          rl.question("Looks like the model unloaded. Reload? [Y/n] ", (input: string) => {
            resolve(input);
          });
        });
        const shouldReload =
          answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
        if (shouldReload) {
          try {
            llmModel = await loadModelWithProgress(client, modelName, ttl, logger);
            process.stdout.write("\n");
            await runPrediction(llmModel, chat, input, logger, rl, ttl, stats);
            return;
          } catch (reloadErr) {
            logger.error("Error reloading model:", reloadErr);
            rl.resume();
            rl.prompt();
          }
        } else {
          // User chose not to reload, exit
          process.exit(0);
        }
      } else {
        logger.error("Error during chat:", err);
        rl.resume();
        rl.prompt();
      }
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
