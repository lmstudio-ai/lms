import type { HubModel } from "@lmstudio/lms-shared-types";
import { type LLM, type LLMPredictionStats, type LMStudioClient, Chat } from "@lmstudio/sdk";
import chalk from "chalk";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { type DeviceNameResolver } from "../../../deviceNameLookup.js";
import { displayVerboseStats } from "../util.js";
import type {
  SlashCommand,
  SlashCommandHandler,
  SlashCommandSuggestionBuilderArgs,
} from "./SlashCommandHandler.js";
import type { ChatUserInputState, InkChatMessage, ModelState, Suggestion } from "./types.js";

export interface CreateSlashCommandsOpts {
  client: LMStudioClient;
  llmRef: RefObject<LLM | null>;
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
  deviceNameResolver: DeviceNameResolver | null;
}

export function createSlashCommands({
  client,
  llmRef,
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
  deviceNameResolver,
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
      handler: async commandArguments => {
        const parsedArgs = parseModelCommandArguments(
          commandArguments,
          downloadedModels,
          deviceNameResolver,
        );
        if (parsedArgs.error !== null) {
          logErrorInChat(parsedArgs.error);
          return;
        }

        if (parsedArgs.modelKey.length === 0) {
          logInChat("Please specify a model to load. Type /model to see the list.");
          return;
        }

        const modelKey = parsedArgs.modelKey;
        const deviceIdentifier = parsedArgs.deviceIdentifier;

        if (llmRef.current !== null) {
          const currentInfo = await llmRef.current.getModelInfo();
          const currentDeviceIdentifier = currentInfo.deviceIdentifier ?? null;

          // Direct identifier match
          if (
            llmRef.current.identifier === modelKey &&
            (deviceIdentifier === undefined || deviceIdentifier === currentDeviceIdentifier)
          ) {
            return;
          }

          // ModelKey match - only return if it's the only loaded instance
          if (llmRef.current.modelKey === modelKey) {
            if (deviceIdentifier !== undefined) {
              if (currentDeviceIdentifier === deviceIdentifier) {
                return;
              }
            } else {
              const loadedInstancesOfThisModel = downloadedModels.filter(
                model => model.modelKey === modelKey && model.isLoaded,
              ).length;
              if (loadedInstancesOfThisModel === 1) {
                return;
              }
            }
          }
        }

        if (deviceIdentifier !== undefined) {
          const matchingModels = downloadedModels.filter(model => model.modelKey === modelKey);
          if (matchingModels.length > 0) {
            const matchingDevice = matchingModels.find(
              model => model.deviceIdentifier === deviceIdentifier,
            );
            if (matchingDevice === undefined) {
              const displayDevice =
                deviceIdentifier === null
                  ? "local"
                  : deviceNameResolver?.label(deviceIdentifier) ?? deviceIdentifier;
              logErrorInChat(`No model "${modelKey}" found on ${displayDevice}.`);
              return;
            }
          }
        }

        setModelLoadingProgress(0);
        const abortController = new AbortController();
        let isModelLoadActive = true;
        modelLoadingAbortControllerRef.current = abortController;
        try {
          llmRef.current = await client.llm.model(modelKey, {
            verbose: false,
            ttl: ttl,
            onProgress(progress) {
              if (abortController.signal.aborted || isModelLoadActive === false) {
                return;
              }
              setModelLoadingProgress(progress);
            },
            signal: abortController.signal,
            deviceIdentifier,
          });
          const loadedInfo = await llmRef.current.getModelInfo();
          const loadedDeviceIdentifier = loadedInfo.deviceIdentifier ?? null;
          const deviceLabel =
            deviceNameResolver === null || deviceNameResolver.isLocal(loadedDeviceIdentifier)
              ? null
              : deviceNameResolver.label(loadedDeviceIdentifier);
          const deviceSuffix = deviceLabel !== null ? ` on ${deviceLabel}` : "";
          logInChat(`Model Selected: ${llmRef.current.displayName}${deviceSuffix}`);
        } catch (error) {
          const errorMessage =
            error instanceof Error && error.message !== undefined ? error.message : String(error);
          if (abortController.signal.aborted) {
            logInChat("Model loading cancelled.");
            return;
          }
          if (errorMessage.includes("Cannot find a model with path")) {
            logErrorInChat(
              `Model "${modelKey}" not found. Use /download to download it or /model to list available models.`,
            );
            return;
          }
          logErrorInChat(`Failed to load model: ${errorMessage}`);
        } finally {
          isModelLoadActive = false;
          setModelLoadingProgress(null);
          modelLoadingAbortControllerRef.current = null;
        }
      },
      buildSuggestions: ({ argsInput, registerSuggestionMetadata }) => {
        const normalizedFilter = argsInput.trim().toLowerCase();
        const filteredModels = downloadedModels.filter(modelState => {
          const deviceHint =
            deviceNameResolver?.label(modelState.deviceIdentifier) ??
            (modelState.deviceIdentifier === null ? "local" : "");
          return (
            modelState.modelKey.toLowerCase().includes(normalizedFilter) ||
            modelState.displayName.toLowerCase().includes(normalizedFilter) ||
            deviceHint.toLowerCase().includes(normalizedFilter)
          );
        });
        return filteredModels.map(modelState =>
          createModelSuggestion({
            modelState,
            registerSuggestionMetadata,
            deviceNameResolver,
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
      name: "download",
      description: "Download a model",
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
  deviceNameResolver: DeviceNameResolver | null;
}

function createModelSuggestion({
  modelState,
  registerSuggestionMetadata,
  deviceNameResolver,
}: CreateModelSuggestionOpts): Suggestion {
  const priority = modelState.isCurrent ? 3 : modelState.isLoaded ? 2 : 1;
  const args = [modelState.modelKey];
  const deviceIdentifier = modelState.deviceIdentifier;
  const deviceName =
    deviceNameResolver !== null &&
    deviceNameResolver.label(deviceIdentifier) !== null &&
    !deviceNameResolver.isLocal(deviceIdentifier)
      ? deviceNameResolver.label(deviceIdentifier)
      : null;

  if (deviceIdentifier !== null) {
    if (deviceName !== null && deviceName.length > 0 && deviceName.includes(" ") === false) {
      args.push(deviceName);
    } else {
      args.push(deviceIdentifier);
    }
  }
  const suggestion: Suggestion = {
    command: "model",
    args,
    priority,
  };
  const statusLabel = modelState.isCurrent ? " (current)" : modelState.isLoaded ? " (loaded)" : "";
  const deviceSuffix =
    deviceName !== null && deviceName.length > 0 ? chalk.dim(` · ${deviceName}`) : "";
  registerSuggestionMetadata(suggestion, {
    label: `${modelState.modelKey}${statusLabel}${deviceSuffix}`,
  });
  return suggestion;
}

/**
 * Parses `/model` arguments where the last argument (if provided) is treated as a device selector
 */
function parseModelCommandArguments(
  commandArguments: string[],
  downloadedModels: Array<ModelState>,
  deviceNameResolver: DeviceNameResolver | null,
): {
  modelKey: string;
  deviceIdentifier?: string | null;
  error: string | null;
} {
  const args = commandArguments.map(arg => arg.trim()).filter(arg => arg.length > 0);
  // If there's only one argument, treat it as the model key and default to local.
  // This is intentional to avoid auto-selecting a preferred remote device when the user
  // doesn't specify a target device.
  if (args.length <= 1) {
    return {
      modelKey: args.join(" ").trim(),
      deviceIdentifier: null,
      error: null,
    };
  }

  // Last argument is treated as the device selector; everything before it is the model key.
  const modelKey = args.slice(0, -1).join(" ").trim();
  const deviceArgument = args[args.length - 1] ?? "";

  // Explicit local device shorthand.
  if (deviceArgument.toLowerCase() === "local") {
    return { modelKey, deviceIdentifier: null, error: null };
  }

  // If the token matches a device identifier directly, use it.
  const directMatch = downloadedModels.find(
    model => model.deviceIdentifier !== null && model.deviceIdentifier === deviceArgument,
  );
  if (directMatch !== undefined && directMatch.deviceIdentifier !== null) {
    return {
      modelKey,
      deviceIdentifier: directMatch.deviceIdentifier,
      error: null,
    };
  }

  // Otherwise, try to resolve the token as a device label
  const normalizedDeviceArgument = deviceArgument.toLowerCase();
  const matchingDeviceIds = new Set<string | null>();
  for (const model of downloadedModels) {
    const deviceIdentifier = model.deviceIdentifier;
    const deviceLabel =
      deviceNameResolver !== null ? deviceNameResolver.label(deviceIdentifier) : "";

    if (deviceLabel.toLowerCase() === normalizedDeviceArgument) {
      matchingDeviceIds.add(deviceIdentifier);
    }
  }

  // If exactly one device matches the label, use it.
  if (matchingDeviceIds.size === 1) {
    const [deviceIdentifier] = matchingDeviceIds;
    return {
      modelKey,
      deviceIdentifier,
      error: null,
    };
  }

  // If multiple devices share the same label, force identifier usage to disambiguate.
  if (matchingDeviceIds.size > 1) {
    return {
      modelKey,
      deviceIdentifier: undefined,
      error: `Multiple devices match "${deviceArgument}". Use the device identifier instead.`,
    };
  }

  // Fall back to treating the token as a device identifier; the load call will validate it.
  return { modelKey, deviceIdentifier: deviceArgument, error: null };
}
