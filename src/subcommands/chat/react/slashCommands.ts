import type { HubModel } from "@lmstudio/lms-shared-types";
import { type LLM, type LLMPredictionStats, type LMStudioClient, Chat } from "@lmstudio/sdk";
import chalk from "chalk";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { displayVerboseStats } from "../util.js";
import { isReasoningMode, REASONING_MODES, type ReasoningMode } from "../reasoning.js";
import type {
  SlashCommand,
  SlashCommandExecutionContext,
  SlashCommandHandler,
  SlashCommandSuggestionBuilderArgs,
} from "./SlashCommandHandler.js";
import type { ChatUserInputState, InkChatMessage, ModelState, Suggestion } from "./types.js";

export interface CreateSlashCommandsOpts {
  client: LMStudioClient;
  llmRef: RefObject<LLM | null>;
  currentModelDeviceIdentifierRef: RefObject<string | null | undefined>;
  chatRef: RefObject<Chat>;
  exitApp: () => void;
  ttl?: number;
  addMessage: (message: InkChatMessage) => void;
  setMessages: Dispatch<SetStateAction<InkChatMessage[]>>;
  setUserInputState: Dispatch<SetStateAction<ChatUserInputState>>;
  downloadedModels: Array<ModelState>;
  modelCatalog: HubModel[] | null;
  handleDownloadCommand: (commandArguments: string[]) => void | Promise<void>;
  logInChat: (message: string) => void;
  logErrorInChat: (message: string) => void;
  shouldFetchModelCatalog?: boolean;
  commandHandler: SlashCommandHandler;
  setModelLoadingProgress: Dispatch<SetStateAction<number | null>>;
  modelLoadingAbortControllerRef: RefObject<AbortController | null>;
  lastPredictionStatsRef: RefObject<LLMPredictionStats | null>;
  reasoningMode: ReasoningMode;
  setReasoningMode: Dispatch<SetStateAction<ReasoningMode>>;
}

export function createSlashCommands({
  client,
  llmRef,
  currentModelDeviceIdentifierRef,
  chatRef,
  exitApp,
  ttl,
  addMessage,
  setMessages,
  setUserInputState,
  downloadedModels,
  modelCatalog,
  handleDownloadCommand,
  logInChat,
  logErrorInChat,
  shouldFetchModelCatalog,
  commandHandler,
  setModelLoadingProgress,
  modelLoadingAbortControllerRef,
  lastPredictionStatsRef,
  reasoningMode,
  setReasoningMode,
}: CreateSlashCommandsOpts): SlashCommand[] {
  return [
    {
      name: "help",
      description: "Show help information",
      handler: async () => {
        const helpText = commandHandler.generateHelpText();
        addMessage({ type: "help", content: helpText });
      },
    },
    {
      name: "exit",
      description: "Exit the chat",
      handler: async () => {
        exitApp();
      },
    },
    {
      name: "model",
      description: "Load a model (type /model to see list)",
      requireArgumentsFromSuggestions: true,
      handler: async (commandArguments, context) => {
        if (commandArguments.length === 0) {
          logInChat("Please specify a model to load. Type /model to see the list.");
          return;
        }

        const modelKey = commandArguments.join(" ");
        const selectedDeviceIdentifier = getSelectedModelDeviceIdentifier(context, modelKey);

        if (
          llmRef.current !== null &&
          (await isCurrentModelSelection({
            llm: llmRef.current,
            modelKey,
            deviceIdentifier: selectedDeviceIdentifier,
            downloadedModels,
          }))
        ) {
          if (selectedDeviceIdentifier !== undefined) {
            currentModelDeviceIdentifierRef.current = selectedDeviceIdentifier;
          }
          return;
        }

        setModelLoadingProgress(0);
        const abortController = new AbortController();
        modelLoadingAbortControllerRef.current = abortController;
        try {
          llmRef.current = await client.llm.model(modelKey, {
            verbose: false,
            ttl: ttl,
            onProgress(progress) {
              setModelLoadingProgress(progress);
            },
            signal: abortController.signal,
            deviceIdentifier: selectedDeviceIdentifier,
          });
          currentModelDeviceIdentifierRef.current = selectedDeviceIdentifier;
          logInChat(`Model Selected: ${llmRef.current.displayName}`);
        } catch (error) {
          const errorMessage =
            error instanceof Error && error.message !== undefined ? error.message : String(error);
          if (errorMessage.includes("Cannot find a model with path")) {
            logErrorInChat(
              `Model "${modelKey}" not found. Use /download to download it or /model to list available models.`,
            );
            return;
          }
          logErrorInChat(`Failed to load model: ${errorMessage}`);
        } finally {
          setModelLoadingProgress(null);
          modelLoadingAbortControllerRef.current = null;
        }
      },
      buildSuggestions: ({ argsInput, registerSuggestionMetadata }) => {
        const normalizedFilter = argsInput.trim().toLowerCase();
        const filteredModels = downloadedModels.filter(modelState => {
          return (
            modelState.modelKey.toLowerCase().includes(normalizedFilter) ||
            modelState.displayName.toLowerCase().includes(normalizedFilter) ||
            modelState.deviceLabel.toLowerCase().includes(normalizedFilter)
          );
        });
        return filteredModels.map(modelState =>
          createModelSuggestion({
            modelState,
            registerSuggestionMetadata,
          }),
        );
      },
    },
    {
      name: "clear",
      description: "Clear the chat history",
      handler: async () => {
        setMessages([]);
        setUserInputState({
          segments: [{ type: "text", content: "" }],
          cursorOnSegmentIndex: 0,
          cursorInSegmentOffset: 0,
        });
        console.clear();
        const systemPrompt = chatRef.current.getSystemPrompt();
        chatRef.current = Chat.empty();
        chatRef.current.append("system", systemPrompt);
        lastPredictionStatsRef.current = null;
      },
    },
    {
      name: "system-prompt",
      description: "Replace the system prompt",
      handler: async commandArguments => {
        const prompt = commandArguments.join(" ");
        if (prompt.length === 0) {
          logInChat("Please provide a system prompt.");
          return;
        }

        chatRef.current.replaceSystemPrompt(prompt);
        logInChat("System prompt updated to: " + prompt);
      },
    },
    {
      name: "stats",
      description: "Show stats of the previous generation",
      handler: async () => {
        if (lastPredictionStatsRef.current === null) {
          logInChat("No previous generation stats available.");
          return;
        }
        displayVerboseStats(lastPredictionStatsRef.current, logInChat);
      },
    },
    {
      name: "reasoning",
      description: "Set reasoning mode (auto, on, off)",
      handler: async commandArguments => {
        if (commandArguments.length === 0) {
          logInChat(`Reasoning mode: ${reasoningMode}`);
          return;
        }
        if (commandArguments.length !== 1) {
          logErrorInChat("Usage: /reasoning auto|on|off");
          return;
        }

        const requestedMode = commandArguments[0]?.toLowerCase();
        if (requestedMode === undefined || isReasoningMode(requestedMode) === false) {
          logErrorInChat("Usage: /reasoning auto|on|off");
          return;
        }

        setReasoningMode(requestedMode);
        logInChat(`Reasoning mode set to: ${requestedMode}`);
      },
      buildSuggestions: ({ argsInput, registerSuggestionMetadata }) => {
        const normalizedFilter = argsInput.trim().toLowerCase();
        return REASONING_MODES.filter(mode => mode.startsWith(normalizedFilter)).map(mode => {
          const suggestion: Suggestion = {
            completionKind: "argument",
            command: "reasoning",
            args: [mode],
            priority: 1,
          };
          registerSuggestionMetadata(suggestion, {
            label: `/reasoning ${mode}`,
          });
          return suggestion;
        });
      },
    },
    {
      name: "download",
      description: "Download a model",
      requireArgumentsFromSuggestions: true,
      handler: handleDownloadCommand,
      buildSuggestions: ({ argsInput, registerSuggestionMetadata }) => {
        if (shouldFetchModelCatalog !== true) {
          return [];
        }
        if (modelCatalog === null) {
          return [];
        }
        const trimmedFilter = argsInput.trim();
        const lowercaseFilter = trimmedFilter.toLowerCase();
        const filteredModels =
          lowercaseFilter.length === 0
            ? modelCatalog
            : modelCatalog.filter(model => {
                return `${model.owner}/${model.name}`.toLowerCase().includes(lowercaseFilter);
              });
        return filteredModels.map(model => {
          const suggestion: Suggestion = {
            completionKind: "argument",
            command: "download",
            args: [`${model.owner}/${model.name}`],
            priority: model.staffPickedAt !== undefined ? 2 : 1,
          };
          registerSuggestionMetadata(suggestion, {
            label: `${model.owner}/${model.name}${
              model.description
                ? chalk.dim(
                    ` - ${
                      model.description.length > 80
                        ? `${model.description.slice(0, 55)}...`
                        : model.description
                    }`,
                  )
                : ""
            }`,
          });
          return suggestion;
        });
      },
    },
  ];
}

interface CreateModelSuggestionOpts {
  modelState: ModelState;
  registerSuggestionMetadata: SlashCommandSuggestionBuilderArgs["registerSuggestionMetadata"];
}

function getSelectedModelDeviceIdentifier(
  context: SlashCommandExecutionContext,
  modelKey: string,
): string | null | undefined {
  const selectedSuggestion = context.selectedSuggestion;
  const execution = selectedSuggestion?.execution;
  if (
    selectedSuggestion?.command !== "model" ||
    selectedSuggestion.args.join(" ") !== modelKey ||
    execution?.type !== "model"
  ) {
    return undefined;
  }
  return execution.deviceIdentifier;
}

async function isCurrentModelSelection({
  llm,
  modelKey,
  deviceIdentifier,
  downloadedModels,
}: {
  llm: LLM;
  modelKey: string;
  deviceIdentifier: string | null | undefined;
  downloadedModels: Array<ModelState>;
}): Promise<boolean> {
  if (deviceIdentifier !== undefined) {
    if (llm.identifier !== modelKey && llm.modelKey !== modelKey) {
      return false;
    }
    try {
      const modelInfo = await llm.getModelInfo();
      return modelInfo.deviceIdentifier === deviceIdentifier;
    } catch {
      return false;
    }
  }

  if (llm.identifier === modelKey) {
    return true;
  }
  if (llm.modelKey !== modelKey) {
    return false;
  }
  const loadedInstancesOfThisModel = downloadedModels.filter(
    model => model.modelKey === modelKey && model.isLoaded,
  ).length;
  return loadedInstancesOfThisModel === 1;
}

function createModelSuggestion({
  modelState,
  registerSuggestionMetadata,
}: CreateModelSuggestionOpts): Suggestion {
  const priority = modelState.isCurrent ? 3 : modelState.isLoaded ? 2 : 1;
  const suggestion: Suggestion = {
    completionKind: "argument",
    command: "model",
    args: [modelState.modelKey],
    priority,
    execution: {
      type: "model",
      deviceIdentifier: modelState.deviceIdentifier,
    },
  };
  const statusLabel = modelState.isCurrent ? " (current)" : modelState.isLoaded ? " (loaded)" : "";
  const deviceSuffix =
    modelState.deviceLabel === "Local" ? "" : ` ${chalk.dim(`on ${modelState.deviceLabel}`)}`;
  registerSuggestionMetadata(suggestion, {
    label: `${modelState.modelKey}${statusLabel}${deviceSuffix}`,
  });
  return suggestion;
}
