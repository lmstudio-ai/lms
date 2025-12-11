import { type Suggestion } from "./types.js";

export interface SlashCommandSuggestionMetadata {
  label: string;
}

export interface SlashCommandSuggestionBuilderArgs {
  argsInput: string;
  registerSuggestionMetadata: (
    suggestion: Suggestion,
    metadata: SlashCommandSuggestionMetadata,
  ) => void;
}

export interface SlashCommandSuggestionsOpts {
  input: string;
  shouldShowSuggestions: boolean;
}

export interface SlashCommand {
  name: string;
  description: string;
  handler: (commandArguments: string[]) => void | Promise<void>;
  buildSuggestions?: (builderArgs: SlashCommandSuggestionBuilderArgs) => Suggestion[];
}

export class SlashCommandHandler {
  private static readonly COMMAND_SUGGESTION_PRIORITY = 0;

  private commands = new Map<string, SlashCommand>();
  private ignoreList = new Set<string>();
  private suggestionMetadata: WeakMap<Suggestion, SlashCommandSuggestionMetadata> = new WeakMap();

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
    this.resetSuggestionMetadata();
    const inputWithTrimmedStart = opts.input.trimStart();
    if (opts.shouldShowSuggestions === false) {
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
        .map<Suggestion>(command => this.createCommandSuggestion(command));
      return SlashCommandHandler.sortSuggestions(matchingCommands);
    }

    const command = this.commands.get(normalizedCommandPortion);
    if (command === undefined || command.buildSuggestions === undefined) {
      return [];
    }

    const argumentsInput = inputWithTrimmedStart.slice(firstWhitespaceIndex + 1);
    const rawSuggestions = command.buildSuggestions({
      argsInput: argumentsInput,
      registerSuggestionMetadata: (suggestion, metadata) => {
        this.registerSuggestionMetadata(suggestion, metadata);
      },
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
      const suggestionArgumentsText =
        selectedSuggestion.args.length > 0 ? selectedSuggestion.args.join(" ") : argumentsText;
      return {
        command: selectedSuggestion.command,
        argumentsText:
          suggestionArgumentsText !== null && suggestionArgumentsText.length > 0
            ? suggestionArgumentsText
            : null,
      };
    }
    return { command, argumentsText };
  }
  static sortSuggestions(suggestions: Suggestion[]): Suggestion[] {
    return [...suggestions].sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      const commandComparison = left.command.localeCompare(right.command);
      if (commandComparison !== 0) {
        return commandComparison;
      }
      const leftArgsText = left.args.join(" ");
      const rightArgsText = right.args.join(" ");
      return leftArgsText.localeCompare(rightArgsText);
    });
  }

  public addToIgnoreList(commandName: string): void {
    this.ignoreList.add(commandName.toLowerCase());
  }

  public commandIsIgnored(commandName: string): boolean {
    return this.ignoreList.has(commandName.toLowerCase());
  }

  public getSuggestionLabel(suggestion: Suggestion): string {
    const metadata = this.suggestionMetadata.get(suggestion);
    if (metadata !== undefined) {
      return metadata.label;
    }
    const argsText = suggestion.args.length > 0 ? ` ${suggestion.args.join(" ")}` : "";
    return `/${suggestion.command}${argsText}`;
  }

  private resetSuggestionMetadata(): void {
    this.suggestionMetadata = new WeakMap<Suggestion, SlashCommandSuggestionMetadata>();
  }

  private createCommandSuggestion(command: SlashCommand): Suggestion {
    const suggestion: Suggestion = {
      command: command.name,
      args: [],
      priority: SlashCommandHandler.COMMAND_SUGGESTION_PRIORITY,
    };
    this.registerSuggestionMetadata(suggestion, {
      label: `/${command.name} - ${command.description}`,
    });
    return suggestion;
  }

  private registerSuggestionMetadata(
    suggestion: Suggestion,
    metadata: SlashCommandSuggestionMetadata,
  ): void {
    this.suggestionMetadata.set(suggestion, metadata);
  }
}
