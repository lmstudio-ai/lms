import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { kebabCaseRegex, kebabCaseWithDotsRegex } from "@lmstudio/lms-shared-types";
import { resolve } from "path";
import { addCreateClientOptions, createClient } from "../createClient.js";
import { createDownloadPbUpdater } from "../downloadPbUpdater.js";
import { exists } from "../exists.js";
import { t } from "../i18n/index.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";
import { ProgressBar } from "../ProgressBar.js";

const artifactIdentifierParser = (str: string): { owner: string; name: string } => {
  str = str.trim().toLowerCase();
  const parts = str.split("/");
  if (parts.length !== 2) {
    throw new InvalidArgumentError(
      "Invalid artifact identifier. Must be in the form of 'owner/name'.",
    );
  }
  const [owner, name] = parts;
  if (!kebabCaseRegex.test(owner)) {
    throw new InvalidArgumentError("Invalid owner. Must be kebab-case.");
  }
  if (!kebabCaseWithDotsRegex.test(name)) {
    throw new InvalidArgumentError("Invalid name. Must be kebab-case (dots allowed).");
  }
  return { owner, name };
};

const cloneCommand = new Command()
  .name("clone")
  .description(t("Clone an artifact from LM Studio Hub to a local folder"))
  .argument(
    "<artifact>",
    t("The identifier for the artifact. Must be in the form of 'owner/name'."),
    artifactIdentifierParser,
  )
  .argument(
    "[path]",
    t(text`
      The path to the folder to clone the resources into. If not provided, defaults to a new
      folder with the artifact name in the current working directory.
  `),
  );

addCreateClientOptions(cloneCommand);
addLogLevelOptions(cloneCommand);

cloneCommand.action(async (artifactIdentifier, path = "", options) => {
  const logger = createLogger(options);
  await using client = await createClient(logger, options);
  const { owner, name } = artifactIdentifier;
  let resolvedPath = path;
  let autoNamed: boolean;
  if (resolvedPath === "") {
    resolvedPath = resolve(`./${name}`);
    autoNamed = true;
    logger.debug(`Path not provided. Using default: ${resolvedPath}`);
  } else {
    resolvedPath = resolve(resolvedPath);
    autoNamed = false;
    logger.debug(`Using provided path: ${resolvedPath}`);
  }
  if (await exists(resolvedPath)) {
    if (autoNamed) {
      logger.error(
        t(
          `Path already exists: {p0}\n       You can provide a different path by providing it as a second argument.`,
          { p0: resolvedPath },
        ),
      );
    } else {
      logger.error(t(`Path already exists: {p0}`, { p0: resolvedPath }));
    }
    process.exit(1);
  }
  const pb = new ProgressBar(0, "", 22);
  const updatePb = createDownloadPbUpdater(pb);
  await client.repository.downloadArtifact({
    owner,
    name,
    revisionNumber: -1, // -1 means the latest revision.
    path: resolvedPath,
    onProgress: update => {
      updatePb(update);
    },
    onStartFinalizing: () => {
      pb.stop();
      logger.info(t("Finalizing download..."));
    },
  });
  logger.info(t(`Artifact successfully cloned to {p0}.`, { p0: resolvedPath }));
});

export const clone = cloneCommand;
