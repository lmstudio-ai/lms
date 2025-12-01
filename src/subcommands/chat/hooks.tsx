import { useEffect, useMemo, useState } from "react";
import { type InkChatMessage, type ModelState, type Suggestion } from "./types.js";
import { type LMStudioClient } from "@lmstudio/sdk";
import { countMessageLines } from "./util.js";

export function useSortedSuggestions(suggestions: Suggestion[]): Suggestion[] {
  return useMemo(() => {
    return [...suggestions].sort((a, b) => {
      if (a.type === "model" && b.type === "model") {
        if (a.data.isCurrent && !b.data.isCurrent) return -1;
        if (!a.data.isCurrent && b.data.isCurrent) return 1;
        if (a.data.isLoaded && !b.data.isLoaded) return -1;
        if (!a.data.isLoaded && b.data.isLoaded) return 1;
        return a.data.modelKey.localeCompare(b.data.modelKey);
      }
      if (a.type === "command" && b.type === "command") {
        return a.data.name.localeCompare(b.data.name);
      }
      // We should not have mixed types here, but just in case
      // prioritize model suggestions
      if (a.type === "model" && b.type === "command") return -1;
      if (a.type === "command" && b.type === "model") return 1;
      return 0;
    });
  }, [suggestions]);
}

export function useModels(
  client: LMStudioClient,
  currentModelIdentifier: string,
): Array<ModelState> {
  const [downloadedModels, setDownloadedModels] = useState<Array<ModelState>>([]);
  useEffect(() => {
    const fetchModels = async () => {
      const downloadedModels = await client.system.listDownloadedModels();
      const loadedModels = await client.llm.listLoaded();
      const models = downloadedModels.map(model => {
        const loadedCount = loadedModels.filter(
          loadedModel => loadedModel.path === model.path,
        ).length;
        const isCurrent = loadedModels.some(
          loadedModel =>
            loadedModel.path === model.path && loadedModel.identifier === currentModelIdentifier,
        );
        return {
          modelKey: model.modelKey,
          isLoaded: loadedCount > 0,
          isCurrent,
        };
      });
      setDownloadedModels(models);
    };

    fetchModels();
  }, [client, currentModelIdentifier]);
  return downloadedModels;
}

export function useSuggestionsPerPage(messages: InkChatMessage[]): number {
  const [terminalSize, setTerminalSize] = useState({
    rows: process.stdout.rows ?? 24,
  });
  const suggestionPerPage = useMemo(() => {
    const reservedLines = messages.reduce((acc, message) => {
      return acc + countMessageLines(message);
    }, 8); // +6 for input prompt and padding
    return Math.max(5, terminalSize.rows - reservedLines);
  }, [messages, terminalSize.rows]);
  useEffect(() => {
    const onResize = () => {
      setTerminalSize({
        rows: process.stdout.rows ?? 24,
      });
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  return suggestionPerPage;
}
