import { Command } from "@commander-js/extra-typings";
import type { SimpleLogger } from "@lmstudio/lms-common";
import type { LLMPredictionStats } from "@lmstudio/lms-shared-types";
import { Chat, type LLM } from "@lmstudio/sdk";
import * as readline from "readline";
import { addCreateClientOptions, createClient } from "../createClient.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";

async function readStdin(): Promise<string> {
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

function displayVerboseStats(stats: LLMPredictionStats, logger: SimpleLogger) {
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

export const chat = addLogLevelOptions(
  addCreateClientOptions(
    new Command()
      .name("chat")
      .description("Open an interactive chat with the currently loaded model.")
      .argument("[model]", "Model name to use")
      .option("-p, --prompt <prompt>", "Print response to stdout and quit")
      .option("-s, --system-prompt <systemPrompt>", "Custom system prompt to use for the chat")
      .option("--stats", "Display detailed prediction statistics after each response"),
  ),
).action(async (model, options) => {
  const logger = createLogger(options);
  const client = await createClient(logger, options);

  let initialPrompt = "";
  if (options.prompt) {
    initialPrompt = options.prompt;
    if (!process.stdin.isTTY) {
      const stdinContent = await readStdin();
      initialPrompt = `${initialPrompt}\n\n${stdinContent}`;
    }
  } else if (!process.stdin.isTTY) {
    initialPrompt = await readStdin();
  }

  let llmModel: LLM;
  if (model) {
    try {
      llmModel = await client.llm.model(model);
    } catch (e) {
      logger.error(`Model "${model}" not found, check available models with:`);
      logger.error("  lms ls");
      process.exit(1);
    }
  } else {
    try {
      llmModel = await client.llm.model();
    } catch (e) {
      logger.error("No loaded default model found, load one first:");
      logger.error("  lms load");
      process.exit(1);
    }
  }
  if (!initialPrompt) {
    logger.info(`Chatting with ${llmModel.identifier}.  Type 'exit', 'quit' or Ctrl+C to quit`);
  }

  const chat = Chat.empty();
  chat.append(
    "system",
    options.systemPrompt ??
      "You are a technical AI assistant. Answer questions clearly, concisely and to-the-point.",
  );

  if (initialPrompt) {
    chat.append("user", initialPrompt);
    try {
      const prediction = llmModel.respond(chat);
      let lastFragment = "";
      for await (const fragment of prediction) {
        process.stdout.write(fragment.content);
        lastFragment = fragment.content;
      }
      const result = await prediction.result();
      chat.append("assistant", result.content);

      if (options.stats) {
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

  if (process.stdin.isTTY) {
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
        chat.append("user", input);
        process.stdout.write("\n● ");
        const prediction = llmModel.respond(chat);

        // Temporarily pause the readline interface
        rl.pause();

        for await (const fragment of prediction) {
          process.stdout.write(fragment.content);
        }
        const result = await prediction.result();
        chat.append("assistant", result.content);

        if (options.stats) {
          displayVerboseStats(result.stats, logger);
        }

        // Resume readline and write a new prompt
        process.stdout.write("\n\n");
        rl.resume();
        rl.prompt();
      } catch (err) {
        logger.error("Error during chat:", err);
        rl.prompt();
      }
    });

    rl.on("close", () => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});
