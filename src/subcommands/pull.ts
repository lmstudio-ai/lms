import { kebabCaseRegex } from "@lmstudio/lms-shared-types";
import { command, positional, string, type Type } from "cmd-ts";
import { resolve } from "path";
import { createClient, createClientArgs } from "../createClient.js";
import { createDownloadPbUpdater } from "../downloadPbUpdater.js";
import { exists } from "../exists.js";
import { createLogger, logLevelArgs } from "../logLevel.js";
import { optionalPositional } from "../optionalPositional.js";
import { ProgressBar } from "../ProgressBar.js";

const artifactIdentifierType: Type<string, { owner: string; name: string }> = {
  async from(str) {
    str = str.trim().toLowerCase();
    const parts = str.split("/");
    if (parts.length !== 2) {
      throw new Error("Invalid plugin identifier. Must be in the form of 'owner/name'.");
    }
    const [owner, name] = parts;
    if (!kebabCaseRegex.test(owner)) {
      throw new Error("Invalid owner. Must be kebab-case.");
    }
    if (!kebabCaseRegex.test(name)) {
      throw new Error("Invalid name. Must be kebab-case.");
    }
    return { owner, name };
  },
};

export const pull = command({
  name: "pull",
  description: "Pull a plugin from LM Studio Hub to a local folder.",
  args: {
    artifactIdentifier: positional({
      displayName: "plugin-identifier",
      description: "The identifier for the plugin. Must be in the form of 'owner/name'.",
      type: artifactIdentifierType,
    }),
    path: optionalPositional({
      displayName: "path",
      description: "The path to the folder to pull the plugin to. I",
      type: string,
      default: "",
    }),
    ...logLevelArgs,
    ...createClientArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    const { owner, name } = args.artifactIdentifier;
    let path = args.path;
    let autoNamed: boolean;
    if (path === "") {
      path = resolve(`./${name}`);
      autoNamed = true;
      logger.debug(`Path not provided. Using default: ${path}`);
    } else {
      path = resolve(path);
      autoNamed = false;
      logger.debug(`Using provided path: ${path}`);
    }
    if (await exists(path)) {
      logger.error(`Path already exists: ${path}`);
      if (autoNamed) {
        logger.error("You can provide a different path by providing it as a second argument.");
      }
      process.exit(1);
    }
    const pb = new ProgressBar(0, "", 22);
    const updatePb = createDownloadPbUpdater(pb);
    await client.repository.downloadArtifact({
      owner,
      name,
      revisionNumber: -1, // -1 means the latest revision.
      path,
      onProgress: update => {
        updatePb(update);
      },
      onStartFinalizing: () => {
        pb.stop();
        logger.info("Finalizing download...");
      },
    });
  },
});
