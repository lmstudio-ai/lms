/**
 * ANSI color codes and theme utilities for inquirer prompts
 *
 * The prompts ship with English labels baked into the library (`keysHelpTip` renders
 * `↑↓ navigate • ⏎ select`, and `style.error` renders the no-results message), and neither is a
 * documented option — both are only reachable through the theme, which is what this module
 * provides. Every label therefore goes through `t()`, so English output stays byte-identical.
 */

import chalk from "chalk";
import { t } from "./i18n/index.js";

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
    // Same shape and colours as the library default; only the action labels are localized.
    // They are prose, unlike `↑↓` / `⏎` / `(Y/n)`, which name the keys the user must press and
    // therefore stay verbatim.
    keysHelpTip: (keys: Array<[string, string]>) =>
      keys
        .map(([key, action]) => `${chalk.bold(key)} ${chalk.dim(t(action))}`)
        .join(chalk.dim(" • ")),
    // The library hard-codes `'No results found'` here; `t()` passes any other message — for
    // example a validator's already-localized text — straight through.
    error: (text: string) => chalk.red(`> ${t(text)}`),
  },
};

/**
 * Default fuzzy filter options for highlighting matches
 */
export const fuzzyHighlightOptions = {
  pre: ANSI_RED,
  post: ANSI_RESET_COLOR,
};
