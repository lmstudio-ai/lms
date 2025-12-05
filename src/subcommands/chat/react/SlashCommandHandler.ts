import { type Suggestion } from "./types.js";

export interface SlashCommand {
  name: string;
  description: string;
  handler: (args: string[]) => void | Promise<void>;
}

export class SlashCommandHandler {
  private commands = new Map<string, SlashCommand>();

  register(command: SlashCommand): void {
    this.commands.set(command.name, command);
  }

  async execute(commandName: string, args: string | null): Promise<boolean> {
    const command = this.commands.get(commandName);

    if (command === undefined) {
      return false;
    }
    const argsArray = args !== null ? args.split(" ") : [];
    await command.handler(argsArray);
    return true;
  }

  list(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  public static parseSlashCommand(
    input: string,
    selectedSuggestion?: Suggestion,
  ): { command: string | null; args: string | null } {
    input = input.trim();
    const result = { command: null, args: null };
    if (!input.startsWith("/")) {
      return result;
    }
    const hasArgs = input.includes(" ");
    const command = hasArgs ? input.slice(1, input.indexOf(" ")) : input.slice(1);
    const args = hasArgs ? input.slice(input.indexOf(" ") + 1).trim() : null;

    // If a suggestion is selected, override the command and args based on the suggestion
    if (selectedSuggestion !== undefined) {
      const suggestionType = selectedSuggestion.type;
      switch (suggestionType) {
        case "command": {
          return {
            command: selectedSuggestion.data.name,
            args: args,
          };
        }
        case "model": {
          return {
            command: "model",
            args: selectedSuggestion.data.modelKey,
          };
        }
        default: {
          const exhaustiveCheck: never = suggestionType;
          throw new Error(`Unhandled suggestion type: ${exhaustiveCheck}`);
        }
      }
    }
    return { command, args };
  }
}
