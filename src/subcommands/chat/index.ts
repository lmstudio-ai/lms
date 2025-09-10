import { Command, Option } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { terminalSize } from "@lmstudio/lms-isomorphic";
import type { HubModel } from "@lmstudio/lms-shared-types";
import { Chat, type LLM, type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import columnify from "columnify";
import fuzzy from "fuzzy";
import inquirer from "inquirer";
import inquirerAutocompletePrompt from "inquirer-autocomplete-prompt";
import * as readline from "readline/promises";
import { getCliPref, type CliPref } from "../../cliPref.js";
import { askQuestion } from "../../confirm.js";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { formatSizeBytes1000 } from "../../formatSizeBytes1000.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { type SimpleFileData } from "../../SimpleFileData.js";
import { createRefinedNumberParser } from "../../types/refinedNumber.js";
import { downloadArtifact } from "../get.js";
import {
  displayVerboseStats,
  executePrediction,
  loadModelWithProgress,
  readStdin,
} from "./util.js";

interface StartPredictionOpts {
  stats?: true;
  ttl: number;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are a technical AI assistant. Answer questions clearly, concisely and to-the-point.";

const MODEL_SELECTION_MESSAGE = "Select a model to chat with";
const MODEL_FILTER_EMPTY_TEXT = "No model matched the filter";
const FETCH_MODEL_CATALOG_MESSAGE =
  "Always fetch the model catalog ? (requires internet connection)";

interface GetOrAskShouldFetchModelCatalogOpts {
  yes?: true;
}

export async function getOrAskShouldFetchModelCatalog(
  offline: boolean,
  cliPref: SimpleFileData<CliPref>,
  logger: SimpleLogger,
  opts: GetOrAskShouldFetchModelCatalogOpts = {},
): Promise<boolean> {
  const fetchModelCatalogPreference = cliPref.get().fetchModelCatalog;
  let shouldFetchModelCatalog = false;
  const { yes } = opts;
  inquirer.registerPrompt("autocomplete", inquirerAutocompletePrompt);
  const { prompt } = inquirer;
  if (offline !== true && fetchModelCatalogPreference !== false) {
    if (fetchModelCatalogPreference === undefined) {
      if (yes === true) {
        cliPref.setWithProducer(draft => {
          draft.fetchModelCatalog = true;
        });
        shouldFetchModelCatalog = true;
        logger.info(
          "Setting the preference to always fetch the model catalog as --yes was provided",
        );
        return shouldFetchModelCatalog;
      }
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
      : // uses columnify to align text in columns because
        // we have both downloaded and local models here
        columnify(
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

/**
 * Handles a single non-interactive chat prompt and exits the process.
 * Streams the response to stdout and optionally displays prediction statistics.
 */
export async function handleNonInteractiveChat(
  llm: LLM,
  chat: Chat,
  prompt: string,
  logger: SimpleLogger,
  opts: StartPredictionOpts,
): Promise<void> {
  try {
    const { result, lastFragment } = await executePrediction(llm, chat, prompt);

    if (opts.stats !== undefined) {
      displayVerboseStats(result.stats, logger);
    }

    if (lastFragment.endsWith("\n") !== true) {
      // Newline before new shell prompt if not already there
      process.stdout.write("\n");
    }
    process.exit(0);
  } catch (err) {
    logger.error("Error during chat:", err);
    process.exit(1);
  }
}

/**
 * Runs a single prediction in an interactive chat session.
 * Pauses readline during prediction and resumes for next input.
 */
async function runInteractivePrediction(
  llm: LLM,
  chat: Chat,
  input: string,
  logger: SimpleLogger,
  rl: readline.Interface,
  opts: StartPredictionOpts,
): Promise<void> {
  process.stdout.write("\n● ");
  rl.pause();

  const { result } = await executePrediction(llm, chat, input);

  if (opts.stats !== undefined) {
    displayVerboseStats(result.stats, logger);
  }

  process.stdout.write("\n\n");
  rl.resume();
  rl.prompt();
}

/**
 * Starts an interactive chat session in the terminal.
 */
export async function startInteractiveChat(
  client: LMStudioClient,
  llm: LLM,
  chat: Chat,
  logger: SimpleLogger,
  modelName: string,
  opts: StartPredictionOpts,
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
    if (input.length === 0) {
      rl.prompt();
      return;
    }

    try {
      await runInteractivePrediction(llm, chat, input, logger, rl, opts);
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes("unloaded") === true) {
        const shouldReload = await askQuestion("Looks like the model unloaded. Reload?", {
          rl,
        });
        if (shouldReload) {
          try {
            llm = await loadModelWithProgress(client, modelName, opts.ttl, logger);
            process.stdout.write("\n");
            await runInteractivePrediction(llm, chat, input, logger, rl, opts);
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

export const chat = addLogLevelOptions(
  addCreateClientOptions(
    new Command()
      .name("chat")
      .description("Open an interactive chat with the currently loaded model.")
      .argument("[model]", "Model name to use")
      .option("-p, --prompt <prompt>", "Print response to stdout and quit")
      .option("-s, --system-prompt <systemPrompt>", "Custom system prompt to use for the chat")
      .option("--stats", "Display detailed prediction statistics after each response")
      .addOption(
        new Option("--ttl <ttl>", "Time (in seconds) to keep the model loaded after the chat ends")
          .argParser(createRefinedNumberParser({ integer: true, min: 1 }))
          .default(3600),
      )
      .option("--offline", "Do not fetch available models to download or updates", false)
      .option("-y, --yes", "Assume 'yes' as answer to all CLI prompts"),
  ),
).action(async (model, options) => {
  const logger = createLogger(options);
  const client = await createClient(logger, options);
  const { offline, yes } = options;

  let providedPrompt = "";
  if (options.prompt !== undefined && options.prompt !== "") {
    providedPrompt = options.prompt;
    if (!process.stdin.isTTY) {
      const stdinContent = await readStdin();
      providedPrompt = `${providedPrompt}\n\n${stdinContent}`;
    }
  } else if (!process.stdin.isTTY) {
    providedPrompt = await readStdin();
  }
  const ttl = +options.ttl;
  if (Number.isSafeInteger(ttl) !== true || ttl < 0) {
    logger.error("Invalid TTL value, must be a non-negative integer.");
    process.exit(1);
  }
  let llm: LLM;
  if (model !== undefined && model !== "") {
    try {
      llm = await client.llm.model(model, {
        ttl,
      });
    } catch (e) {
      logger.error(`Model "${model}" not found, check available models with:\n       lms ls`);
      process.exit(1);
    }
  } else {
    try {
      llm = await client.llm.model();
    } catch (e) {
      if (!process.stdin.isTTY) {
        logger.error("No loaded model found, load with:\n       lms load");
        process.exit(1);
      }
      // No model loaded, offer to download a model from the catalog or use
      // existing downloaded model
      const cliPref = await getCliPref(logger);

      let modelCatalogModels: HubModel[] = [];
      const shouldFetchModelCatalog = await getOrAskShouldFetchModelCatalog(
        offline,
        cliPref,
        logger,
      );

      if (shouldFetchModelCatalog) {
        try {
          modelCatalogModels = await client.repository.unstable.getModelCatalog();
        } catch (err) {
          // If error says network connection failed,
          // then we are offline, so just use empty the empty model catalog
          if (err instanceof Error && err.message.toLowerCase().includes("network") === true) {
            logger.warn("Offline, unable to fetch model catalog");
          } else {
            logger.error("Error fetching model catalog:", err);
          }
          modelCatalogModels = [];
        }
      }

      const modelCatalogModelNames = modelCatalogModels.map(m => m.owner + "/" + m.name);

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
      const filteredModels = models.filter(
        m => modelCatalogModelNames.includes(m.modelKey) !== true,
      );
      const modelKeys = models.map(model => model.modelKey);

      const modelsMap = [
        ...modelCatalogModels
          .map(m => {
            return {
              name: m.owner + "/" + m.name,
              isDownloaded: modelKeys.includes(m.owner + "/" + m.name),
              size: m.metadata.minMemoryUsageBytes,
              inModelCatalog: true,
            };
          })
          .sort(m => (m.isDownloaded === true ? -1 : 1)),
        ...filteredModels.map(m => {
          return {
            name: m.path,
            isDownloaded: true,
            size: m.sizeBytes,
            inModelCatalog: false,
          };
        }),
      ];

      // Pre-compute all display options to avoid recreation on each keystroke
      const displayOptions = createModelDisplayOptions(modelsMap, offline);

      inquirer.registerPrompt("autocomplete", inquirerAutocompletePrompt);
      const { prompt } = inquirer;
      const answers = await prompt([
        {
          type: "autocomplete",
          name: "model",
          message: MODEL_SELECTION_MESSAGE,
          loop: false,
          pageSize: terminalSize().rows - 4,
          emptyText: MODEL_FILTER_EMPTY_TEXT,
          source: async (_answersSoFar: any, input: string | undefined) => {
            if (input === undefined || input.length === 0) return displayOptions;
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
        if (selectedModel.inModelCatalog) {
          // Download artifact from hub
          const [owner, name] = selectedModel.name.split("/");
          await downloadArtifact(client, logger, owner, name, yes ?? false);
          // Wait for model indexing to complete after download
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // It is not a model from the catalog, so must be a direct model
          // which is not downloaded, unexpected path as only
          // cataloged models are offered to download
          logger.error(
            `Model ${selectedModel.name} is not downloaded. Please download the model first with 'lms get'.`,
          );
          process.exit(1);
        }
      }
      llm = await loadModelWithProgress(client, selectedModel.name, ttl, logger);
    }
  }
  if (!providedPrompt) {
    logger.info(`Chatting with ${llm.identifier}.  Type 'exit', 'quit' or Ctrl+C to quit`);
  }

  const chat = Chat.empty();
  chat.append("system", options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);

  if (providedPrompt) {
    await handleNonInteractiveChat(llm, chat, providedPrompt, logger, {
      stats: options.stats,
      ttl,
    });
  } else if (process.stdin.isTTY) {
    await startInteractiveChat(client, llm, chat, logger, (await llm.getModelInfo()).modelKey, {
      stats: options.stats,
      ttl,
    });
  } else {
    logger.error("No prompt provided for non-interactive chat.");
    process.exit(0);
  }
});
