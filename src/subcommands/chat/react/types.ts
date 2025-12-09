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

export type ChatUserInputState = string;
