import { type ChatInput } from "@lmstudio/sdk";
import { command, option, optional, restPositionals, string } from "cmd-ts";
import * as readline from "readline";
import { createClient, createClientArgs } from "../createClient.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (chunk) => {
      input += chunk;
    });

    process.stdin.on('end', () => {
      resolve(input.trim());
    });
  });
}

export const chat = command({
  name: "chat",
  description: "Open a chat REPL with the currently loaded model",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
    model: restPositionals({
      displayName: "model",
      description: "Model name to use",
      type: string,
    }),
    prompt: option({
      type: optional(string),
      long: "prompt",
      short: "p",
      description: "Respond to prompt stdout and quit",
    }),
    systemPrompt: option({
      type: optional(string),
      long: "system-prompt",
      short: "s",
      description: "Custom system prompt to use for the chat",
    }),
  },
  async handler(args) {
    const logger = createLogger(args);
    const client = await createClient(logger, args);

    let initialPrompt = '';
    if (args.prompt) {
      initialPrompt = args.prompt;
    } else if (!process.stdin.isTTY) {
      initialPrompt = await readStdin();
    }

    let model;
    const modelKey = args.model && args.model.length > 0 ? args.model[0] : undefined;
    if (modelKey) {
      try {
        model = await client.llm.model(modelKey);

      } catch (e) {
        logger.error(`Model "${modelKey}" not found, check available models with:`);
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
      logger.info(`Chatting with ${model.identifier}`);
    }

    const history: ChatInput = [
      {
        role: "system",
        content: args.systemPrompt ?? "You are a technical AI assistant. Answer questions clearly, concisely and to-the-point."
      }
    ];


    if (initialPrompt) {
      history.push({ role: "user", content: initialPrompt });
      try {
        const prediction = model.respond(history);
        let lastFragment = '';
        for await (const fragment of prediction) {
          process.stdout.write(fragment.content);
          lastFragment = fragment.content;
        }
        const result = await prediction.result();
        history.push({ role: "assistant", content: result.content });

        if(!lastFragment.endsWith('\n')) {
          // Newline before new shell prompt if not already there
          process.stdout.write('\n');
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
          history.push({ role: "user", content: input });
          process.stdout.write("\n● ");
          const prediction = model.respond(history);

          // Temporarily pause the readline interface
          rl.pause();

          for await (const fragment of prediction) {
            process.stdout.write(fragment.content);
          }
          const result = await prediction.result();
          history.push({ role: "assistant", content: result.content });

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