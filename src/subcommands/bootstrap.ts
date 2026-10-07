import { Command } from "@commander-js/extra-typings";
import { installCli } from "@lmstudio/lms-lmstudio/install-cli";
import { platform } from "os";
import { t } from "../i18n/index.js";

export const bootstrap = new Command()
  .name("bootstrap")
  .description(t("Bootstrap the CLI"))
  .option("-y, --yes", t("Skip confirmation prompts"))
  .action(async options => {
    const { yes: skipConfirmation = false } = options;
    await installCli({ skipConfirmation: skipConfirmation || platform() !== "linux" });
  });
