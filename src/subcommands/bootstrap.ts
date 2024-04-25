import { installCli } from "@lmstudio/lms-lmstudio/dist/installCli";
import { command } from "cmd-ts";

export const bootstrap = command({
  name: "bootstrap",
  description: "Bootstrap the CLI",
  args: {},
  handler: async () => {
    await installCli({ skipConfirmation: true });
  },
});
