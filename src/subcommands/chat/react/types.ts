import { type SlashCommand } from "./SlashCommandHandler.js";

export type InkChatMessage =
  | {
      type: "user";
      content: Array<{
        type: "text" | "largePaste";
        text: string;
      }>;
    }
  | {
      type: "assistant";
      content: Array<{
        type: "reasoning" | "response";
        text: string;
      }>;
      displayName: string;
      stoppedByUser: boolean;
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
  | { type: "model"; data: ModelState }
  | {
      type: "downloadableModel";
      data: {
        owner: string;
        name: string;
        downloads: number;
        likeCount: number;
        staffPickedAt: number | undefined;
      };
    };

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
