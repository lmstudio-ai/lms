import { type ChatInput } from "@lmstudio/sdk";
import { boolean, command, flag, option, optional, restPositionals, string } from "cmd-ts";
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

export const ask = command({
  name: "ask",
  description: "Open a chat REPL with the currently loaded model",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
    prompt: restPositionals({
      displayName: "prompt",
      description: "Initial prompt to send",
      type: string,
    }),
    print: flag({
      type: boolean,
      long: "print",
      short: "p",
      description: "Print the response to the initial prompt and exit",
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

    let model;
    try {
      model = await client.llm.model();
    } catch (e) {
      logger.error("Failed to get the loaded model. Make sure a model is loaded:");
      logger.error("  lms load <model-path>");
      process.exit(1);
    }

    const history: ChatInput = [
      {
        role: "system",
        content: args.systemPrompt ?? "You are a technical AI assistant. Answer questions clearly, concisely, to-the-point."
      }
    ];

    let initialPrompt = '';
    if (args.prompt.length > 0) {
      initialPrompt = args.prompt.join(" ");
    } else if (!process.stdin.isTTY) {
      initialPrompt = await readStdin();
      if (args.print) {
        history.push({ role: "user", content: initialPrompt });
        try {
          const prediction = model.respond(history);
          for await (const fragment of prediction) {
            process.stdout.write(fragment.content);
          }
          process.stdout.write("\n");
          process.exit(0);
        } catch (err) {
          logger.error("Error during chat:", err);
          process.exit(1);
        }
      }
    }

    if (initialPrompt) {
      history.push({ role: "user", content: initialPrompt });
      try {
        const prediction = model.respond(history);
        for await (const fragment of prediction) {
          process.stdout.write(fragment.content);
        }
        const result = await prediction.result();
        history.push({ role: "assistant", content: result.content });
      } catch (err) {
        logger.error("Error during chat:", err);
        process.exit(1);
      }
    }

    if (args.print) {
      if (!initialPrompt) {
        logger.error("Error: --print flag requires an initial prompt.");
        process.exit(1);
      }
      process.exit(0);
    }

    if (process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "> ",
      });

      rl.prompt();

      rl.on("line", async (line: string) => {
        const input = line.trim();
        if (input === "exit" || input === "quit") {
          rl.close();
          return;
        }

        try {
          history.push({ role: "user", content: input });
          process.stdout.write("\n");
          const prediction = model.respond(history);
          for await (const fragment of prediction) {
            process.stdout.write(fragment.content);
          }
          const result = await prediction.result();
          history.push({ role: "assistant", content: result.content });
        } catch (err) {
          logger.error("Error during chat:", err);
        }

        rl.prompt();
      });

      rl.on("close", () => {
        logger.info("Chat session ended.");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  },
});