/**
 * ANSI color codes and theme utilities for inquirer prompts
 */

// ANSI color codes
export const ANSI_TEAL = "\x1b[36m";
export const ANSI_CYAN = "\x1b[96m";
export const ANSI_RED = "\x1b[91m";
export const ANSI_RESET_COLOR = "\x1b[39m";
export const ANSI_RESET_ALL = "\x1b[0m";

/**
 * Highlights selected text in teal for inquirer search prompts.
 * Wraps the text and preserves any reset sequences within it.
 */
export const highlightSelectedText = (value: string) => {
  // Re-apply teal after any "reset foreground color" codes inside the string.
  const valueWithResetColor = value.replaceAll(ANSI_RESET_COLOR, `${ANSI_RESET_COLOR}${ANSI_TEAL}`);
  // Re-apply teal after any "reset all styles" codes inside the string.
  const valueWithResetAll = valueWithResetColor.replaceAll(
    ANSI_RESET_ALL,
    `${ANSI_RESET_ALL}${ANSI_TEAL}`,
  );
  // Start in teal and reset foreground color at the end to avoid color leakage.
  return `${ANSI_TEAL}${valueWithResetAll}${ANSI_RESET_COLOR}`;
};

/**
 * Default theme configuration for inquirer search prompts
 */
export const searchTheme = {
  style: {
    highlight: highlightSelectedText,
  },
};

/**
 * Default fuzzy filter options for highlighting matches
 */
export const fuzzyHighlightOptions = {
  pre: ANSI_RED,
  post: ANSI_RESET_COLOR,
};
