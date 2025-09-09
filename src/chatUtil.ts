import type { SimpleLogger } from "@lmstudio/lms-common";
import { type Chat, type LMStudioClient, type LLM, type LLMPredictionStats } from "@lmstudio/sdk";
import inquirer from "inquirer";
import inquirerAutocompletePrompt from "inquirer-autocomplete-prompt";
import { type CliPref } from "./cliPref.js";
import chalk from "chalk";
import { formatSizeBytes1000 } from "./formatSizeBytes1000.js";
import { ProgressBar } from "./ProgressBar.js";
import columnify from "columnify";
import { type SimpleFileData } from "./SimpleFileData.js";
import * as readline from "readline";

inquirer.registerPrompt("autocomplete", inquirerAutocompletePrompt);
const { prompt } = inquirer;

const FETCH_MODEL_CATALOG_MESSAGE =
  "Always fetch the model catalog ? (requires internet connection)";

export async function handleModelCatalogPreference(
  offline: boolean,
  cliPref: SimpleFileData<CliPref>,
  logger: SimpleLogger,
): Promise<boolean> {
  const fetchModelCatalogPreference = cliPref.get().fetchModelCatalog;
  let shouldFetchModelCatalog = false;

  if (offline !== true && fetchModelCatalogPreference !== false) {
    if (fetchModelCatalogPreference === undefined) {
      // We do not consider options.yes here because we want user to explicitly
      // allow fetching model catalog. This is a one-time question.
      const fetchAnswer = await prompt([
        {
          type: "confirm",
          name: "fetch",
          message: FETCH_MODEL_CATALOG_MESSAGE,
        },
      ]);
      cliPref.setWithProducer(draft => {
        draft.fetchModelCatalog = fetchAnswer.fetch;
      });
      if (fetchAnswer.fetch === true) {
        logger.info("Setting the preference to always fetch the model catalog.");
        shouldFetchModelCatalog = true;
      }
    } else if (fetchModelCatalogPreference === true) {
      shouldFetchModelCatalog = true;
    }
  }

  return shouldFetchModelCatalog;
}

export function createModelDisplayOptions(
  modelsMap: Array<{ name: string; isDownloaded: boolean; size: number; inModelCatalog: boolean }>,
  offline: boolean,
) {
  return modelsMap.map((model, index) => {
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
}

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

export async function startInteractiveChat(
  llmModel: LLM,
  chat: Chat,
  options: { stats?: boolean },
  logger: SimpleLogger,
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

      if (options.stats !== undefined) {
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
}
