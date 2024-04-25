import { installCli } from "@lmstudio/lms-lmstudio/dist/installCli";
import { command } from "cmd-ts";
import { platform } from "os";

export const bootstrap = command({
  name: "bootstrap",
  description: "Bootstrap the CLI",
  args: {},
  handler: async () => {
    await installCli({ skipConfirmation: platform() !== "linux" });
  },
});
