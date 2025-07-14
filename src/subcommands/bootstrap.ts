import { installCli } from "@lmstudio/lms-lmstudio/install-cli";
import { command, flag } from "cmd-ts";
import { platform } from "os";

export const bootstrap = command({
  name: "bootstrap",
  description: "Bootstrap the CLI",
  args: {
    yes: flag({
      long: "yes",
      short: "y",
      description: "Skip confirmation prompts",
      defaultValue: () => false,
    }),
  },
  handler: async args => {
    await installCli({ skipConfirmation: args.yes || platform() !== "linux" });
  },
});
