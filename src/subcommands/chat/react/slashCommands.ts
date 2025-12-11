import { type LLM, type LMStudioClient, Chat } from "@lmstudio/sdk";
import type { HubModel } from "@lmstudio/lms-shared-types";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SlashCommand, SlashCommandHandler } from "./SlashCommandHandler.js";
import type { ChatUserInputState, InkChatMessage, ModelState } from "./types.js";

export interface CreateSlashCommandsOpts {
  client: LMStudioClient;
  llmRef: RefObject<LLM | null>;
  chatRef: RefObject<Chat>;
  exitApp: () => void;
  ttl?: number;
  abortControllerRef: RefObject<AbortController | null>;
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
}

export function createSlashCommands({
  client,
  llmRef,
  chatRef,
  exitApp,
  ttl,
  abortControllerRef,
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
        if (commandArguments.length === 0) {
          logInChat("Please specify a model to load. Type /model to see the list.");
          return;
        }

        const modelKey = commandArguments.join(" ");

        if (llmRef.current !== null && modelKey === llmRef.current.modelKey) {
          return;
        }

        setModelLoadingProgress(0);
        try {
          llmRef.current = await client.llm.model(modelKey, {
            verbose: false,
            ttl: ttl,
            onProgress(progress) {
              setModelLoadingProgress(progress);
            },
            signal: abortControllerRef.current?.signal,
          });
          logInChat(`Model Selected: ${llmRef.current.displayName}`);
        } catch (error) {
          const errorMessage =
            error instanceof Error && error.message !== undefined ? error.message : String(error);
          logErrorInChat(`Failed to load model: ${errorMessage}`);
        } finally {
          setModelLoadingProgress(null);
        }
      },
      buildSuggestions: ({ argsInput }) => {
        const normalizedFilter = argsInput.trim().toLowerCase();
        const filteredModels = downloadedModels.filter(modelState => {
          return (
            modelState.modelKey.toLowerCase().includes(normalizedFilter) ||
            modelState.displayName.toLowerCase().includes(normalizedFilter)
          );
        });
        return filteredModels.map(modelState => ({ type: "model", data: modelState }));
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
      name: "download",
      description: "Download a model",
      handler: handleDownloadCommand,
      buildSuggestions: ({ argsInput }) => {
        if (shouldFetchModelCatalog !== true) {
          return [];
        }
        if (modelCatalog === null) {
          return [];
        }
        const trimmedFilter = argsInput.trim();
        const lowercaseFilter = trimmedFilter.toLowerCase();
        if (lowercaseFilter.length === 0) {
          return modelCatalog.map(model => ({
            type: "downloadableModel" as const,
            data: {
              owner: model.owner,
              name: model.name,
              downloads: model.downloads,
              likeCount: model.likeCount,
              staffPickedAt: model.staffPickedAt,
            },
          }));
        }
        const filteredModels = modelCatalog.filter(model => {
          return `${model.owner}/${model.name}`.toLowerCase().includes(lowercaseFilter);
        });
        return filteredModels.map(model => ({
          type: "downloadableModel" as const,
          data: {
            owner: model.owner,
            name: model.name,
            downloads: model.downloads,
            likeCount: model.likeCount,
            staffPickedAt: model.staffPickedAt,
          },
        }));
      },
    },
  ];
}
