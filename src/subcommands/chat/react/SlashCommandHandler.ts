import { type ModelState, type Suggestion } from "./types.js";

export interface SlashCommandSuggestionBuilderArgs {
  argsInput: string;
  models: ModelState[];
  fetchDownloadableModels: (filterText: string) => Promise<Suggestion[]>;
}

export interface SlashCommandSuggestionsOpts {
  input: string;
  isPredicting: boolean;
  isConfirmReloadActive: boolean;
  models: ModelState[];
  fetchDownloadableModels: (filterText: string) => Promise<Suggestion[]>;
}

export interface SlashCommand {
  name: string;
  description: string;
  handler: (commandArguments: string[]) => void | Promise<void>;
  buildSuggestions?: (
    builderArgs: SlashCommandSuggestionBuilderArgs,
  ) => Suggestion[] | Promise<Suggestion[]>;
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

  async getSuggestions(opts: SlashCommandSuggestionsOpts): Promise<Suggestion[]> {
    const inputWithTrimmedStart = opts.input.trimStart();
    if (
      inputWithTrimmedStart.startsWith("/") === false ||
      opts.isPredicting === true ||
      opts.isConfirmReloadActive === true
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
      return this.list()
        .filter(command => command.name.toLowerCase().startsWith(normalizedCommandPortion))
        .map(command => ({ type: "command", data: command }));
    }

    const command = this.commands.get(normalizedCommandPortion);
    if (command === undefined || command.buildSuggestions === undefined) {
      return [];
    }

    const argumentsInput = inputWithTrimmedStart.slice(firstWhitespaceIndex + 1);
    return await command.buildSuggestions({
      argsInput: argumentsInput,
      models: opts.models,
      fetchDownloadableModels: opts.fetchDownloadableModels,
    });
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
}
