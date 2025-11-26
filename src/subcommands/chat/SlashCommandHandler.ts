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

  async execute(input: string): Promise<boolean> {
    if (input.startsWith("/")) {
      input = input.slice(1);
    }
    const [commandName, ...args] = input.split(" ");
    const command = this.commands.get(commandName);

    if (command === undefined) {
      return false;
    }

    await command.handler(args);
    return true;
  }

  list(): SlashCommand[] {
    return Array.from(this.commands.values());
  }
}
