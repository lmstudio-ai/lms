import { Command } from "@commander-js/extra-typings";
import type { SimpleLogger } from "@lmstudio/lms-common";
import type { LLMPredictionStats, StaffPickedArtifact } from "@lmstudio/lms-shared-types";
import { Chat, type LLM } from "@lmstudio/sdk";
import * as readline from "readline";
import { addCreateClientOptions, createClient } from "../createClient.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";
import inquirer from "inquirer";
import inquirerAutocompletePrompt from "inquirer-autocomplete-prompt";
import { getCliPref } from "../cliPref.js";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import fuzzy from "fuzzy";
import chalk from "chalk";
import { formatSizeBytes1000 } from "../formatSizeBytes1000.js";
import { downloadArtifact } from "./get.js";
import { ProgressBar } from "../ProgressBar.js";
import columnify from "columnify";

inquirer.registerPrompt("autocomplete", inquirerAutocompletePrompt);
const { prompt } = inquirer;

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
      .option("--stats", "Display detailed prediction statistics after each response")
      .option(
        "--ttl <ttl>",
        "Time (in seconds) to keep the model loaded after the chat ends",
        "3600",
      )
      .option("--offline", "Do not fetch available models to download or updates", false)
      .option("-y, --yes", "Automatic yes to prompts, assume 'yes' as answer to all prompts"),
  ),
).action(async (model, options) => {
  const logger = createLogger(options);
  const client = await createClient(logger, options);
  const { offline, yes } = options;

  let initialPrompt = "";
  if (options.prompt !== undefined && options.prompt !== "") {
    initialPrompt = options.prompt;
    if (!process.stdin.isTTY) {
      const stdinContent = await readStdin();
      initialPrompt = `${initialPrompt}\n\n${stdinContent}`;
    }
  } else if (!process.stdin.isTTY) {
    initialPrompt = await readStdin();
  }

  const ttl = parseInt(options.ttl, 10);
  if (isNaN(ttl) || ttl < 0) {
    logger.error("Invalid TTL value, must be a non-negative integer.");
    process.exit(1);
  }
  let llmModel: LLM;
  if (model !== undefined && model !== "") {
    try {
      llmModel = await client.llm.model(model, {
        ttl,
      });
    } catch (e) {
      logger.error(`Model "${model}" not found, check available models with:\n       lms ls`);
      process.exit(1);
    }
  } else {
    try {
      llmModel = await client.llm.model();
    } catch (e) {
      if (!process.stdin.isTTY) {
        logger.error("No loaded model found, load with:\n       lms load");
        process.exit(1);
      }
      // No model loaded, offer to download a staff pick or use existing downloaded model
      const cliPref = await getCliPref(logger);

      let staffPicks: StaffPickedArtifact[] = [];
      if (offline !== true) {
        try {
          staffPicks = await client.repository.fetchStaffPicks();
        } catch (err) {
          // If error says network connection failed,
          // then we are offline, so just use empty staff picks
          if (err instanceof Error && err.message.toLowerCase().includes("network") === true) {
            logger.warn("Offline, unable to fetch staff picks");
          } else {
            logger.error("Error fetching staff picks:", err);
          }
          staffPicks = [];
        }
      }
      const staffPickNames = staffPicks.map(m => m.owner + "/" + m.name);

      const lastLoadedModels = cliPref.get().lastLoadedModels ?? [];
      const lastLoadedIndexToPathMap = [...lastLoadedModels.entries()];
      const lastLoadedMap = new Map(lastLoadedIndexToPathMap.map(([index, path]) => [path, index]));
      const models = (await client.system.listDownloadedModels())
        .filter(model => model.architecture?.toLowerCase().includes("clip") !== true)
        .sort((a, b) => {
          const aIndex = lastLoadedMap.get(a.path) ?? lastLoadedMap.size + 1;
          const bIndex = lastLoadedMap.get(b.path) ?? lastLoadedMap.size + 1;
          return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0;
        });
      const filteredModels = models.filter(m => staffPickNames.includes(m.modelKey) !== true);
      const modelKeys = models.map(model => model.modelKey);

      const modelsMap = [
        ...staffPicks
          .map(m => {
            return {
              name: m.owner + "/" + m.name,
              isDownloaded: modelKeys.includes(m.owner + "/" + m.name),
              size: m.sizeBytes,
              staffPicked: true,
            };
          })
          .sort(m => (m.isDownloaded === true ? -1 : 1)),
        ...filteredModels.map(m => {
          return {
            name: m.path,
            isDownloaded: true,
            size: m.sizeBytes,
            staffPicked: false,
          };
        }),
      ];

      // Pre-compute all display options to avoid recreation on each keystroke
      const displayOptions = modelsMap.map((model, index) => {
        const status = model.isDownloaded === false ? "DOWNLOAD" : "";
        const size = formatSizeBytes1000(model.size);

        const displayName = offline
          ? `${model.name} ${chalk.gray(`(${size})`)}`
          : columnify(
              [
                {
                  name: model.name,
                  size: chalk.gray(`(min. ${size})`),
                  status: chalk.gray(status),
                },
              ],
              {
                showHeaders: false,
                config: {
                  name: { minWidth: 50 },
                  size: { minWidth: 16 },
                  status: { minWidth: 10 },
                },
              },
            ).trim();

        return {
          name: displayName,
          value: model.name,
          searchText: model.name,
          originalIndex: index,
        };
      });

      const answers = await prompt([
        {
          type: "autocomplete",
          name: "model",
          message: "Select a model to chat with",
          loop: false,
          pageSize: terminalSize().rows - 4,
          emptyText: "No model matched the filter",
          source: async (_: any, input: string) => {
            if (!input) return displayOptions;
            const options = fuzzy.filter(input, displayOptions, { extract: el => el.searchText });
            return options.map(option => option.original);
          },
        },
      ]);

      const selectedModel = modelsMap.find(m => m.name === answers.model);

      if (selectedModel === undefined) {
        logger.error("No model selected, exiting.");
        process.exit(1);
      }
      if (!selectedModel.isDownloaded) {
        if (selectedModel.staffPicked) {
          // Download artifact from hub
          const [owner, name] = selectedModel.name.split("/");
          await downloadArtifact(client, logger, owner, name, yes ?? false);
          // Wait for model indexing to complete after download
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // It is not a staff pick, so must be a direct model
          // which is not downloaded, unexpected path as
          // only staff picks are offered to download
          logger.error(
            `Model ${selectedModel.name} is not downloaded. Please download the model first with 'lms get'.`,
          );
          process.exit(1);
        }
      }
      const progressBar = new ProgressBar();
      const abortController = new AbortController();
      const sigintListener = () => {
        progressBar.stop();
        abortController.abort();
        logger.warn("Load cancelled.");
        process.exit(1);
      };
      process.addListener("SIGINT", sigintListener);

      llmModel = await client.llm.model(selectedModel.name, {
        verbose: false,
        onProgress: progress => {
          progressBar.setRatio(progress);
        },
        signal: abortController.signal,
        ttl,
      });
      process.removeListener("SIGINT", sigintListener);
      progressBar.stop();
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
