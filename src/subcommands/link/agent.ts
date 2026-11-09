import { Command } from "@commander-js/extra-typings";
import { confirm } from "@inquirer/prompts";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { UserInputError } from "../../types/UserInputError.js";
import { type LinkCommandOptions } from "./shared.js";

export const agent = new Command<[], LinkCommandOptions>()
  .name("agent")
  .description("Show or change agentic use on this device");

addCreateClientOptions(agent);
addLogLevelOptions(agent);

/** Reports the saved opt-in, or Runner policy on a managed device. */
agent.action(async function () {
  const options = this.optsWithGlobals();
  const logger = createLogger(options);
  await using client = await createClient(logger, options);
  const { enabled, managed } = await client.repository.lmLink.getAgentStatus();
  logger.info(
    `Agentic use is ${enabled ? "enabled" : "disabled"} on this device${managed ? " (managed by Runner policy)" : ""}.`,
  );
});

for (const [name, enabled] of [
  ["enable", true],
  ["disable", false],
] as const) {
  const command = new Command<[], LinkCommandOptions>()
    .name(name)
    .description(`${enabled ? "Enable" : "Disable"} agentic use on this device`);
  if (enabled) {
    command.option("-y, --yes", "Enable agentic use without confirmation");
  }

  /** Confirms the access being granted before asking the host to change its opt-in. */
  command.action(async function () {
    const options = this.optsWithGlobals();
    const logger = createLogger(options);
    if (enabled && options.yes !== true) {
      if (process.stdin.isTTY !== true) {
        throw new UserInputError(
          "Enabling agentic use requires confirmation. Run again with --yes to continue.",
        );
      }
      process.stderr.write(
        "Enabling agentic use lets you run agents on this device from your other\n" +
          "devices in your LM Link network.\n\n" +
          "Agents can read and modify files and run commands with your user permissions.\n" +
          "This can effectively give your other devices full control of this device.\n\n",
      );
      let confirmed = false;
      try {
        confirmed = await confirm(
          {
            message: "Enable agentic use?",
            default: false,
            theme: {
              style: {
                /** Keeps the displayed choices explicit; Enter still declines. */
                defaultAnswer: () => "(Y/N)",
              },
            },
          },
          { output: process.stderr },
        );
      } catch (error: unknown) {
        if (!(error instanceof Error) || error.name !== "ExitPromptError") {
          throw error;
        }
      }
      if (!confirmed) {
        logger.info("Canceled. The agentic-use setting was not changed.");
        return;
      }
    }

    await using client = await createClient(logger, options);
    await client.repository.lmLink.setAgentEnabled(enabled);
    logger.info(`Agentic use is ${enabled ? "enabled" : "disabled"} on this device.`);
    if (enabled) {
      logger.info("Remote access requires LM Link to be enabled and connected.");
    }
  });
  agent.addCommand(command);
}
