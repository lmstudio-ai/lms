import { Command, Option, type OptionValues } from "@commander-js/extra-typings";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { Chat, type LLM, type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import columnify from "columnify";
import { confirm } from "@inquirer/prompts";
import { getCliPref, type CliPref } from "../../cliPref.js";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../../createClient.js";
import { formatSizeBytes1000 } from "../../formatBytes.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { type SimpleFileData } from "../../SimpleFileData.js";
import { createRefinedNumberParser } from "../../types/refinedNumber.js";
import { displayVerboseStats, executePrediction, readStdin } from "./util.js";
import { runPromptWithExitHandling } from "../../prompt.js";
import { render } from "ink";
import { ChatComponent } from "./react/Chat.js";
import { getCachedModelCatalogOrFetch } from "./catalogHelpers.js";
import { maybeGetLLM } from "./getLLM.js";

interface StartPredictionOpts {
  stats?: true;
  ttl: number;
}

type ChatCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    prompt?: string;
    systemPrompt?: string;
    stats?: true;
    ttl: number;
    dontFetchCatalog: boolean;
    yes?: boolean;
  };

export const DEFAULT_SYSTEM_PROMPT =
  "You are an AI assistant running in the user's terminal. Provide helpful and concise responses.";

const FETCH_MODEL_CATALOG_MESSAGE =
  "Always fetch the model catalog ? (requires internet connection)";

export async function getOrAskShouldFetchModelCatalog(
  dontFetchCatalog: boolean,
  cliPref: SimpleFileData<CliPref>,
  logger: SimpleLogger,
): Promise<boolean> {
  const fetchModelCatalogPreference = cliPref.get().fetchModelCatalog;
  let shouldFetchModelCatalog = false;
  if (dontFetchCatalog !== true && fetchModelCatalogPreference !== false && process.stdin.isTTY) {
    if (fetchModelCatalogPreference === undefined) {
      const fetchAnswer = await runPromptWithExitHandling(() =>
        confirm(
          {
            message: FETCH_MODEL_CATALOG_MESSAGE,
          },
          { output: process.stderr },
        ),
      );
      cliPref.setWithProducer(draft => {
        draft.fetchModelCatalog = fetchAnswer;
      });
      if (fetchAnswer === true) {
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
  dontFetchCatalog: boolean,
) {
  return modelsMap.map((model, index) => {
    const status = model.isDownloaded === false ? "DOWNLOAD" : "";
    const size = formatSizeBytes1000(model.size);

    const displayName = dontFetchCatalog
      ? `${model.name} ${chalk.dim(`(${size})`)}`
      : // uses columnify to align text in columns because we have both downloaded and local models
        // here.
        columnify(
          [
            {
              name: model.name,
              size: chalk.dim(`(min. ${size})`),
              status: chalk.dim(status),
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
 * Handles a single non-interactive chat prompt and exits the process. Streams the response to
 * stdout and optionally displays prediction statistics.
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
      displayVerboseStats(result.stats, logger.info.bind(logger));
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
 * Starts an interactive chat session in the terminal.
 */
export async function startInteractiveChat(
  client: LMStudioClient,
  chat: Chat,
  opts: StartPredictionOpts,
  llm: LLM | undefined,
  shouldFetchModelCatalog: boolean,
): Promise<void> {
  return new Promise<void>(resolve => {
    render(
      <ChatComponent
        client={client}
        llm={llm}
        chat={chat}
        stats={opts.stats}
        ttl={opts.ttl}
        onExit={() => {
          resolve();
        }}
        shouldFetchModelCatalog={shouldFetchModelCatalog}
      />,
      {
        exitOnCtrlC: false,
      },
    );
  });
}

const chatCommandBase = new Command<[], ChatCommandOptions>()
  .name("chat")
  .description("Start an interactive chat with a model")
  .argument("[model]", "Model name to use")
  .option("-p, --prompt <prompt>", "Print response to stdout and quit")
  .option("-s, --system-prompt <systemPrompt>", "Custom system prompt to use for the chat")
  .option("--stats", "Display detailed prediction statistics after each response")
  .addOption(
    new Option("--ttl <ttl>", "Time (in seconds) to keep the model loaded after the chat ends")
      .argParser(createRefinedNumberParser({ integer: true, min: 1 }))
      .default(3600),
  )
  .option("--dont-fetch-catalog", "Skip fetching the model catalog", false)
  .option("-y, --yes", "Assume 'yes' as answer to all CLI prompts");

const chatCommandWithClient = addCreateClientOptions(chatCommandBase);
const chatCommand = addLogLevelOptions(chatCommandWithClient);

chatCommand.action(async (model, options: ChatCommandOptions) => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);
  const { dontFetchCatalog, yes } = options;

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
  const chat = Chat.empty();
  chat.append("system", options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  const cliPref = await getCliPref(logger);
  const shouldFetchModelCatalog = await getOrAskShouldFetchModelCatalog(
    dontFetchCatalog,
    cliPref,
    logger,
  );

  if (shouldFetchModelCatalog) {
    // Pre-fetch model catalog to speed up later model selection
    await getCachedModelCatalogOrFetch(client);
  }

  const llm = await maybeGetLLM(client, model, ttl, shouldFetchModelCatalog, logger, yes);

  // We intentionally do not check for a model being loaded here, as that is handled
  // inside startInteractiveChat to allow model selection inside the interactive chat flow
  if (process.stdin.isTTY && providedPrompt.length === 0) {
    await startInteractiveChat(
      client,
      chat,
      {
        stats: options.stats,
        ttl,
      },
      llm,
      shouldFetchModelCatalog,
    );
    return;
  }

  if (providedPrompt.length !== 0) {
    if (llm === undefined) {
      // Cannot reach this point in non-interactive mode but we check anyway
      logger.error("No model loaded. Please specify a model to chat with.");
      process.exit(1);
    }
    await handleNonInteractiveChat(llm, chat, providedPrompt, logger, {
      stats: options.stats,
      ttl,
    });
  } else {
    logger.error("No prompt provided for non-interactive chat.");
    process.exit(0);
  }
});

export const chat = chatCommand;
