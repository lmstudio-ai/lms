import { type ChatInput, type PredictionResult } from "@lmstudio/sdk";
import { command, restPositionals, string } from "cmd-ts";
import * as readline from "readline";
import { createClient, createClientArgs } from "../createClient.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

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

    const history : ChatInput = [
      {
        role: "system",
        content: "You are a helpful AI assistant. Answer questions clearly and concisely."
      }
    ];

    // Handle initial prompt if provided
    if (args.prompt.length > 0) {
      const initialPrompt = args.prompt.join(" ");
      history.push({ role: "user", content: initialPrompt });
      try {
        const completion: PredictionResult = await model.respond(history);
        console.log(completion.content);
        history.push({ role: "assistant", content: completion.content });
      } catch (err) {
        logger.error("Error during chat:", err);
      }
    }

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
        const completion: PredictionResult = await model.respond(history);
        console.log(completion.content);
        history.push({ role: "assistant", content: completion.content });
      } catch (err) {
        logger.error("Error during chat:", err);
      }

      rl.prompt();
    });

    rl.on("close", () => {
      logger.info("Chat session ended.");
      process.exit(0);
    });
  },
});