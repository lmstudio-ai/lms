import { command } from "cmd-ts";
import { cwd } from "process";
import { createClient, createClientArgs } from "../createClient";
import { findProjectFolderOrExit } from "../findProjectFolder";
import { createLogger, logLevelArgs } from "../logLevel";

export const push = command({
  name: "push",
  description: "Uploads the plugin in the current folder to LM Studio Hub.",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    const projectPath = await findProjectFolderOrExit(logger, cwd());
    await client.repository.push(projectPath);
  },
});
