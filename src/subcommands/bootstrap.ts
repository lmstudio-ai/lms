import { Command } from "@commander-js/extra-typings";
import { installCli } from "@lmstudio/lms-lmstudio/install-cli";
import { platform } from "os";

export const bootstrap = new Command()
  .name("bootstrap")
  .description("Bootstrap the CLI")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async options => {
    const { yes: skipConfirmation = false } = options;
    await installCli({ skipConfirmation: skipConfirmation || platform() !== "linux" });
  });
