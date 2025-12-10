import { type Suggestion } from "./types.js";

export interface SlashCommandSuggestionBuilderArgs {
  argsInput: string;
}

export interface SlashCommandSuggestionsOpts {
  input: string;
  isPredicting: boolean;
  isConfirmationActive: boolean;
}

export interface SlashCommand {
  name: string;
  description: string;
  handler: (commandArguments: string[]) => void | Promise<void>;
  buildSuggestions?: (builderArgs: SlashCommandSuggestionBuilderArgs) => Suggestion[];
}

export class SlashCommandHandler {
  private commands = new Map<string, SlashCommand>();

  register(command: SlashCommand): void {
    const normalizedName = command.name.toLowerCase();
    this.commands.set(normalizedName, command);
  }

  setCommands(commands: SlashCommand[]): void {
    this.commands.clear();
    commands.forEach(command => {
      this.register(command);
    });
  }

  async execute(commandName: string, argumentsText: string | null): Promise<boolean> {
    const command = this.commands.get(commandName.toLowerCase());

    if (command === undefined) {
      return false;
    }
    const commandArguments =
      argumentsText !== null
        ? argumentsText.split(" ").filter(argument => argument.length > 0)
        : [];
    await command.handler(commandArguments);
    return true;
  }

  list(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  generateHelpText(): string {
    const sortedCommands = this.list().sort((leftCommand, rightCommand) =>
      leftCommand.name.localeCompare(rightCommand.name),
    );
    const commandsText = sortedCommands
      .map(command => `/${command.name} - ${command.description}`)
      .join("\n");
    return `Available commands:\n${commandsText}\n`;
  }

  getSuggestions(opts: SlashCommandSuggestionsOpts): Suggestion[] {
    const inputWithTrimmedStart = opts.input.trimStart();
    if (
      inputWithTrimmedStart.startsWith("/") === false ||
      opts.isPredicting === true ||
      opts.isConfirmationActive === true
    ) {
      return [];
    }

    const firstWhitespaceIndex = inputWithTrimmedStart.indexOf(" ");
    const hasArguments = firstWhitespaceIndex !== -1;
    const commandPortion = hasArguments
      ? inputWithTrimmedStart.slice(1, firstWhitespaceIndex)
      : inputWithTrimmedStart.slice(1);
    const normalizedCommandPortion = commandPortion.toLowerCase();

    if (hasArguments === false) {
      const matchingCommands = this.list()
        .filter(command => command.name.toLowerCase().startsWith(normalizedCommandPortion))
        .map(command => ({ type: "command", data: command }) as Suggestion);
      return SlashCommandHandler.sortSuggestions(matchingCommands);
    }

    const command = this.commands.get(normalizedCommandPortion);
    if (command === undefined || command.buildSuggestions === undefined) {
      return [];
    }

    const argumentsInput = inputWithTrimmedStart.slice(firstWhitespaceIndex + 1);
    const rawSuggestions = command.buildSuggestions({
      argsInput: argumentsInput,
    });
    return SlashCommandHandler.sortSuggestions(rawSuggestions);
  }

  public static parseSlashCommand(
    input: string,
    selectedSuggestion?: Suggestion,
  ): { command: string | null; argumentsText: string | null } {
    const trimmedInput = input.trim();
    const result = { command: null, argumentsText: null };
    if (trimmedInput.startsWith("/") === false) {
      return result;
    }
    const hasArguments = trimmedInput.includes(" ");
    const command = hasArguments
      ? trimmedInput.slice(1, trimmedInput.indexOf(" "))
      : trimmedInput.slice(1);
    const argumentsText = hasArguments
      ? trimmedInput.slice(trimmedInput.indexOf(" ") + 1).trim()
      : null;

    if (selectedSuggestion !== undefined) {
      const suggestionType = selectedSuggestion.type;
      switch (suggestionType) {
        case "command": {
          return {
            command: selectedSuggestion.data.name,
            argumentsText,
          };
        }
        case "model": {
          return {
            command: "model",
            argumentsText: selectedSuggestion.data.modelKey,
          };
        }
        case "downloadableModel": {
          return {
            command: "download",
            argumentsText: `${selectedSuggestion.data.owner}/${selectedSuggestion.data.name}`,
          };
        }
        default: {
          const exhaustiveCheck: never = suggestionType;
          throw new Error(`Unhandled suggestion type: ${exhaustiveCheck}`);
        }
      }
    }
    return { command, argumentsText };
  }
  static sortSuggestions(suggestions: Suggestion[]): Suggestion[] {
    const suggestionsCopy = [...suggestions];
    suggestionsCopy.sort((leftSuggestion, rightSuggestion) => {
      if (leftSuggestion.type === "model" && rightSuggestion.type === "model") {
        if (leftSuggestion.data.isCurrent === true && rightSuggestion.data.isCurrent !== true) {
          return -1;
        }
        if (leftSuggestion.data.isCurrent !== true && rightSuggestion.data.isCurrent === true) {
          return 1;
        }
        if (leftSuggestion.data.isLoaded === true && rightSuggestion.data.isLoaded !== true) {
          return -1;
        }
        if (leftSuggestion.data.isLoaded !== true && rightSuggestion.data.isLoaded === true) {
          return 1;
        }
        return leftSuggestion.data.modelKey.localeCompare(rightSuggestion.data.modelKey);
      }
      if (leftSuggestion.type === "command" && rightSuggestion.type === "command") {
        return leftSuggestion.data.name.localeCompare(rightSuggestion.data.name);
      }
      if (leftSuggestion.type === "model" && rightSuggestion.type === "command") {
        return -1;
      }
      if (leftSuggestion.type === "command" && rightSuggestion.type === "model") {
        return 1;
      }
      return 0;
    });
    return suggestionsCopy;
  }
}
