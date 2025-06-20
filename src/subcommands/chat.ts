import { Chat, type LLM } from "@lmstudio/sdk";
import { command, flag, option, optional, string } from "cmd-ts";
import * as readline from "readline";
import { createClient, createClientArgs } from "../createClient.js";
import { createLogger, logLevelArgs } from "../logLevel.js";
import { optionalPositional } from "../optionalPositional.js";
import type { LLMPredictionStats } from "@lmstudio/lms-shared-types";
import type { SimpleLogger } from "@lmstudio/lms-common";

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

export const chat = command({
  name: "chat",
  description: "Open an interactive chat with the currently loaded model.",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
    model: optionalPositional({
      displayName: "model",
      description: "Model name to use",
      type: string,
      default: "",
    }),
    prompt: option({
      type: optional(string),
      long: "prompt",
      short: "p",
      description: "Print response to stdout and quit",
    }),
    systemPrompt: option({
      type: optional(string),
      long: "system-prompt",
      short: "s",
      description: "Custom system prompt to use for the chat",
    }),
    stats: flag({
      long: "stats",
      description: "Display detailed prediction statistics after each response",
    }),
  },
  async handler(args) {
    const logger = createLogger(args);
    const client = await createClient(logger, args);

    let initialPrompt = "";
    if (args.prompt) {
      initialPrompt = args.prompt;
      if (!process.stdin.isTTY) {
        const stdinContent = await readStdin();
        initialPrompt = `${initialPrompt}\n\n${stdinContent}`;
      }
    } else if (!process.stdin.isTTY) {
      initialPrompt = await readStdin();
    }

    let model: LLM;
    if (args.model) {
      try {
        model = await client.llm.model(args.model);
      } catch (e) {
        logger.error(`Model "${args.model}" not found, check available models with:`);
        logger.error("  lms ls");
        process.exit(1);
      }
    } else {
      try {
        model = await client.llm.model();
      } catch (e) {
        logger.error("No loaded default model found, load one first:");
        logger.error("  lms load");
        process.exit(1);
      }
    }
    if (!initialPrompt) {
      logger.info(`Chatting with ${model.identifier}.  Type 'exit', 'quit' or Ctrl+C to quit`);
    }

    const chat = Chat.empty();
    chat.append(
      "system",
      args.systemPrompt ??
        "You are a technical AI assistant. Answer questions clearly, concisely and to-the-point.",
    );

    if (initialPrompt) {
      chat.append("user", initialPrompt);
      try {
        const prediction = model.respond(chat);
        let lastFragment = "";
        for await (const fragment of prediction) {
          process.stdout.write(fragment.content);
          lastFragment = fragment.content;
        }
        const result = await prediction.result();
        chat.append("assistant", result.content);

        if (args.stats) {
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
          const prediction = model.respond(chat);

          // Temporarily pause the readline interface
          rl.pause();

          for await (const fragment of prediction) {
            process.stdout.write(fragment.content);
          }
          const result = await prediction.result();
          chat.append("assistant", result.content);

          if (args.stats) {
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
  },
});
