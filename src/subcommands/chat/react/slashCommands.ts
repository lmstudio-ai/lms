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
  deviceNameResolver: DeviceNameResolver;
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
        const deviceSpecified = parsedArgs.deviceSpecified;
        const normalizedDeviceIdentifier = deviceSpecified
          ? deviceNameResolver.normalizeIdentifier(deviceIdentifier ?? null)
          : undefined;

        const currentLlm = llmRef.current;
        if (currentLlm !== null) {
          let currentInfo: Awaited<ReturnType<LLM["getModelInfo"]>> | null = null;
          try {
            currentInfo = await currentLlm.getModelInfo();
          } catch {
            llmRef.current = null;
          }
          if (currentInfo !== null) {
            const currentDeviceIdentifier = currentInfo.deviceIdentifier ?? null;
            const normalizedCurrentDeviceIdentifier =
              deviceNameResolver.normalizeIdentifier(currentDeviceIdentifier);

            // Direct identifier match
            if (
              currentLlm.identifier === modelKey &&
              (normalizedDeviceIdentifier === undefined ||
                normalizedDeviceIdentifier === normalizedCurrentDeviceIdentifier)
            ) {
              return;
            }

            // ModelKey match - only return if it's the only loaded instance
            if (currentLlm.modelKey === modelKey) {
              if (normalizedDeviceIdentifier !== undefined) {
                if (normalizedCurrentDeviceIdentifier === normalizedDeviceIdentifier) {
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
        }

        if (deviceSpecified) {
          if (deviceIdentifier === undefined) {
            logErrorInChat("Multiple devices match the selection. Use the device identifier.");
            return;
          }
          const matchingModels = downloadedModels.filter(model => model.modelKey === modelKey);
          if (matchingModels.length > 0) {
            const matchingDevice = matchingModels.find(
              model => model.deviceIdentifier === deviceIdentifier,
            );
            if (matchingDevice === undefined) {
              const displayDevice =
                deviceIdentifier === null
                  ? "local"
                  : deviceNameResolver.label(deviceIdentifier);
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
            deviceIdentifier: deviceSpecified ? deviceIdentifier : undefined,
          });
          const loadedInfo = await llmRef.current.getModelInfo();
          const loadedDeviceIdentifier = loadedInfo.deviceIdentifier ?? null;
          const deviceLabel = deviceNameResolver.isLocal(loadedDeviceIdentifier)
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
        const deviceLabelIds = new Map<string, Set<string>>();
        const modelKeyDevices = new Map<string, Set<string | null>>();
        for (const modelState of downloadedModels) {
          const deviceIdentifier = modelState.deviceIdentifier;
          const label = deviceNameResolver.label(deviceIdentifier);
          const normalizedLabel = label.toLowerCase();
          const identifierKey =
            deviceIdentifier ?? deviceNameResolver.localDeviceIdentifier ?? "local";
          const existing = deviceLabelIds.get(normalizedLabel);
          if (existing === undefined) {
            deviceLabelIds.set(normalizedLabel, new Set([identifierKey]));
          } else {
            existing.add(identifierKey);
          }
        }
        for (const modelState of downloadedModels) {
          const existing = modelKeyDevices.get(modelState.modelKey);
          if (existing === undefined) {
            modelKeyDevices.set(modelState.modelKey, new Set([modelState.deviceIdentifier]));
          } else {
            existing.add(modelState.deviceIdentifier);
          }
        }
        const filteredModels = downloadedModels.filter(modelState => {
          const deviceHint = deviceNameResolver.label(modelState.deviceIdentifier);
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
            deviceLabelIds,
            modelKeyDevices,
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
  deviceNameResolver: DeviceNameResolver;
  deviceLabelIds: Map<string, Set<string>>;
  modelKeyDevices: Map<string, Set<string | null>>;
}

function createModelSuggestion({
  modelState,
  registerSuggestionMetadata,
  deviceNameResolver,
  deviceLabelIds,
  modelKeyDevices,
}: CreateModelSuggestionOpts): Suggestion {
  const priority = modelState.isCurrent ? 3 : modelState.isLoaded ? 2 : 1;
  const args = [modelState.modelKey];
  const deviceIdentifier = modelState.deviceIdentifier;
  const isLocalDevice = deviceNameResolver.isLocal(deviceIdentifier);
  const deviceName = deviceNameResolver.label(deviceIdentifier);
  const normalizedDeviceName = deviceName.toLowerCase();
  const isDeviceLabelUnique = (deviceLabelIds.get(normalizedDeviceName)?.size ?? 0) === 1;
  const modelKeyDeviceCount = modelKeyDevices.get(modelState.modelKey)?.size ?? 0;
  const shouldForceLocal = isLocalDevice === true && modelKeyDeviceCount > 1;

  if (deviceIdentifier !== null && isLocalDevice !== true) {
    if (
      deviceName.length > 0 && deviceName.includes(" ") === false && isDeviceLabelUnique
    ) {
      args.push(deviceName);
    } else {
      args.push(deviceIdentifier);
    }
  } else if (shouldForceLocal) {
    if (deviceName !== null && deviceName.length > 0) {
      args.push(deviceName);
    } else {
      args.push("local");
    }
  }
  const suggestion: Suggestion = {
    command: "model",
    args,
    priority,
  };
  const statusLabel = modelState.isCurrent ? " (current)" : modelState.isLoaded ? " (loaded)" : "";
  const deviceSuffix = deviceName.length > 0 ? chalk.dim(` · ${deviceName}`) : "";
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
  deviceNameResolver: DeviceNameResolver,
): {
  modelKey: string;
  deviceIdentifier?: string | null;
  error: string | null;
  deviceSpecified: boolean;
} {
  const args = commandArguments.map(arg => arg.trim()).filter(arg => arg.length > 0);
  // If there's only one argument, treat it as the model key and let the SDK pick
  // the preferred device when the user doesn't specify a target device.
  if (args.length <= 1) {
    return {
      modelKey: args.join(" ").trim(),
      deviceIdentifier: undefined,
      error: null,
      deviceSpecified: false,
    };
  }

  const fullModelKey = args.join(" ").trim();

  const resolveDeviceSelection = (): {
    matched: boolean;
    deviceIdentifier?: string | null;
    error: string | null;
    deviceSpecified: boolean;
    tokenCount?: number;
  } => {
    const lastToken = args[args.length - 1] ?? "";
    // Explicit local device shorthand.
    if (lastToken.toLowerCase() === "local") {
      return {
        matched: true,
        deviceIdentifier: null,
        error: null,
        deviceSpecified: true,
        tokenCount: 1,
      };
    }

    // If the token matches a device identifier directly, use it.
    if (lastToken.length > 0) {
      const directMatch = downloadedModels.find(
        model => model.deviceIdentifier !== null && model.deviceIdentifier === lastToken,
      );
      if (directMatch !== undefined && directMatch.deviceIdentifier !== null) {
        return {
          matched: true,
          deviceIdentifier: directMatch.deviceIdentifier,
          error: null,
          deviceSpecified: true,
          tokenCount: 1,
        };
      }
    }

    // Otherwise, try to resolve the token as a device label.
    const labelToDeviceIds = new Map<string, Set<string | null>>();
    for (const model of downloadedModels) {
      const deviceIdentifier = model.deviceIdentifier;
      const deviceLabel = deviceNameResolver.label(deviceIdentifier);
      const normalizedLabel = deviceLabel.toLowerCase();
      const existing = labelToDeviceIds.get(normalizedLabel);
      if (existing === undefined) {
        labelToDeviceIds.set(normalizedLabel, new Set([deviceIdentifier]));
      } else {
        existing.add(deviceIdentifier);
      }
    }

    const maxSuffixTokens = args.length - 1;
    for (let tokenCount = maxSuffixTokens; tokenCount >= 1; tokenCount -= 1) {
      const suffix = args.slice(-tokenCount).join(" ").trim();
      if (suffix.length === 0) {
        continue;
      }
      const matchingDeviceIds = labelToDeviceIds.get(suffix.toLowerCase());
      if (matchingDeviceIds === undefined) {
        continue;
      }
      if (matchingDeviceIds.size === 1) {
        const [deviceIdentifier] = matchingDeviceIds;
        return {
          matched: true,
          deviceIdentifier,
          error: null,
          deviceSpecified: true,
          tokenCount,
        };
      }
      return {
        matched: true,
        deviceIdentifier: undefined,
        error: `Multiple devices match "${suffix}". Use the device identifier instead.`,
        deviceSpecified: true,
        tokenCount,
      };
    }

    return { matched: false, error: null, deviceSpecified: false };
  };

  const resolvedDevice = resolveDeviceSelection();
  if (resolvedDevice.matched) {
    const tokenCount = resolvedDevice.tokenCount ?? 1;
    const modelKeyWithoutDevice = args.slice(0, -tokenCount).join(" ").trim();
    return {
      modelKey: modelKeyWithoutDevice,
      deviceIdentifier: resolvedDevice.deviceIdentifier,
      error: resolvedDevice.error,
      deviceSpecified: resolvedDevice.deviceSpecified,
    };
  }

  // If the last token isn't a known device selector, treat the entire input as the model key.
  return {
    modelKey: fullModelKey,
    deviceIdentifier: undefined,
    error: null,
    deviceSpecified: false,
  };
}
