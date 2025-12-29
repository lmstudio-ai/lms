import { Box, Text } from "ink";
import React, { useCallback } from "react";
import type { Suggestion } from "./types.js";

interface ChatSuggestionsProps {
  suggestions: Suggestion[];
  selectedSuggestionIndex: number | null;
  suggestionsPerPage: number;
  getSuggestionLabel: (suggestion: Suggestion) => string;
}

export const ChatSuggestions = React.memo(
  ({
    suggestions,
    selectedSuggestionIndex,
    suggestionsPerPage,
    getSuggestionLabel,
  }: ChatSuggestionsProps) => {
    const totalPages = Math.ceil(suggestions.length / suggestionsPerPage);
    const currentPage =
      selectedSuggestionIndex !== null
        ? Math.floor(selectedSuggestionIndex / suggestionsPerPage)
        : 0;
    const startIndex = currentPage * suggestionsPerPage;
    const endIndex = Math.min(startIndex + suggestionsPerPage, suggestions.length);
    const visibleSuggestions = suggestions.slice(startIndex, endIndex);

    const renderSuggestion = useCallback(
      (suggestion: Suggestion, visibleSuggestionIndex: number) => {
        const globalIndex = startIndex + visibleSuggestionIndex;
        const label = getSuggestionLabel(suggestion);
        const suggestionKey = `${suggestion.command}-${suggestion.args.join(":")}-${
          suggestion.priority
        }-${globalIndex}`;
        return (
          <Box key={suggestionKey}>
            <Text inverse={selectedSuggestionIndex === globalIndex}>{label}</Text>
          </Box>
        );
      },
      [getSuggestionLabel, selectedSuggestionIndex, startIndex],
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
          <Box>
            <Text dimColor>
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
