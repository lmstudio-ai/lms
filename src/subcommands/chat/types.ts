import { type SlashCommand } from "./SlashCommandHandler.js";

export type InkChatMessage =
  | {
      type: "user";
      content: string;
    }
  | {
      type: "assistant";
      content: Array<{
        type: "reasoning" | "response";
        text: string;
      }>;
      displayName: string;
    }
  | {
      type: "help";
      content: string;
    }
  | {
      type: "log";
      content: string;
    }
  | {
      type: "error";
      content: string;
    }
  | {
      type: "welcome";
    };

export type ModelState = {
  modelKey: string;
  isLoaded: boolean;
  isCurrent: boolean;
};

export type Suggestion =
  | { type: "command"; data: SlashCommand }
  | { type: "model"; data: ModelState };

export type ChatInputSegment =
  | {
      type: "text";
      content: string;
    }
  | {
      type: "largePaste";
      content: string;
    };

export interface ChatUserInputState {
  segments: ChatInputSegment[];
  cursorOnSegmentIndex: number;
  cursorInSegmentOffset: number;
}
