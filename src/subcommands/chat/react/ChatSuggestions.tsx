import { Box, Text } from "ink";
import React, { useCallback } from "react";
import type { Suggestion } from "./types.js";

interface ChatSuggestionsProps {
  suggestions: Suggestion[];
  selectedSuggestionIndex: number;
  suggestionsPerPage: number;
}

export const ChatSuggestions = React.memo(
  ({ suggestions, selectedSuggestionIndex, suggestionsPerPage }: ChatSuggestionsProps) => {
    const totalPages = Math.ceil(suggestions.length / suggestionsPerPage);
    const currentPage = Math.floor(selectedSuggestionIndex / suggestionsPerPage);
    const startIndex = currentPage * suggestionsPerPage;
    const endIndex = Math.min(startIndex + suggestionsPerPage, suggestions.length);
    const visibleSuggestions = suggestions.slice(startIndex, endIndex);

    const renderSuggestion = useCallback(
      (suggestion: Suggestion, visibleSuggestionIndex: number) => {
        const globalIndex = startIndex + visibleSuggestionIndex;
        const suggestionType = suggestion.type;

        switch (suggestionType) {
          case "command": {
            return (
              <Box key={suggestion.data.name}>
                <Text inverse={selectedSuggestionIndex === globalIndex}>
                  /{suggestion.data.name} - {suggestion.data.description}
                </Text>
              </Box>
            );
          }
          case "model": {
            const model = suggestion.data;
            return (
              <Box key={model.modelKey}>
                <Text bold={model.isCurrent} inverse={selectedSuggestionIndex === globalIndex}>
                  {model.modelKey}
                  {model.isLoaded ? " (loaded)" : model.isCurrent ? " (current)" : null}
                </Text>
              </Box>
            );
          }
          case "downloadableModel": {
            const model = suggestion.data;
            return (
              <Box key={`${model.owner}/${model.name}`}>
                <Text inverse={selectedSuggestionIndex === globalIndex}>
                  {model.owner}/{model.name}
                </Text>
              </Box>
            );
          }
          default: {
            const exhaustiveCheck: never = suggestionType;
            throw new Error(`Unhandled suggestion type: ${exhaustiveCheck}`);
          }
        }
      },
      [startIndex, selectedSuggestionIndex],
    );

    if (suggestions.length === 0) {
      return null;
    }

    return (
      <Box flexDirection="column" marginLeft={2}>
        {visibleSuggestions.map((suggestion, visibleSuggestionIndex) =>
          renderSuggestion(suggestion, visibleSuggestionIndex),
        )}
        {totalPages > 1 && (
          <Box marginTop={1}>
            <Text color="gray">
              {Array.from({ length: totalPages }, (_unused, pageIndex) =>
                pageIndex === currentPage ? "●" : "○",
              ).join(" ")}
            </Text>
          </Box>
        )}
      </Box>
    );
  },
);
