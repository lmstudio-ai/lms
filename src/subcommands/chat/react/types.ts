/**
 * Internal type to represent how ink is rendering messages. Note that this is NOT 1:1 to chat
 * history, because a single assistant message is split into multiple chunks for performant
 * rendering.
 */
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
  displayName: string;
};

export interface Suggestion {
  command: string;
  args: string[];
  priority: number;
}

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
