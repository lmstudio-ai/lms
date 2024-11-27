import { command } from "cmd-ts";
import { cwd } from "process";
import { createClient, createClientArgs } from "../createClient.js";
import { findProjectFolderOrExit } from "../findProjectFolder.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

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
    await client.repository.pushArtifact({
      path: projectPath,
      onMessage: message => logger.info(message),
    });
  },
});
