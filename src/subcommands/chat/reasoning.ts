export const REASONING_MODES = ["auto", "on", "off"] as const;

export type ReasoningMode = (typeof REASONING_MODES)[number];

export function isReasoningMode(value: string): value is ReasoningMode {
  return REASONING_MODES.some(mode => mode === value);
}

export function reasoningModeToPredictionOpts(
  reasoningMode: ReasoningMode,
): { enableThinking?: boolean } {
  switch (reasoningMode) {
    case "auto":
      return {};
    case "on":
      return { enableThinking: true };
    case "off":
      return { enableThinking: false };
  }
}
