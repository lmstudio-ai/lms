import { type SimpleLogger, text } from "@lmstudio/lms-common";
import {
  type ArtifactDependency,
  artifactManifestSchema,
  kebabCaseRegex,
  kebabCaseWithDotsRegex,
  type LocalArtifactFileList,
  type ModelDownloadSource,
  type ModelManifest,
  virtualModelDefinitionSchema,
} from "@lmstudio/lms-shared-types";
import chalk from "chalk";
import { boolean, command, flag, option, optional, string, type Type } from "cmd-ts";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { cwd } from "process";
import YAML from "yaml";
import { askQuestion } from "../confirm.js";
import { createClient, createClientArgs } from "../createClient.js";
import { ensureAuthenticated } from "../ensureAuthenticated.js";
import { exists } from "../exists.js";
import { findProjectFolderOrExit } from "../findProjectFolder.js";
import { formatSizeBytes1000 } from "../formatSizeBytes1000.js";
import { createLogger, logLevelArgs } from "../logLevel.js";

const overridesType: Type<string, any> = {
  async from(str) {
    return JSON.parse(str);
  },
  displayName: "JSON",
  description: "A JSON string",
};

export const push = command({
  name: "push",
  description: "Uploads the plugin in the current folder to LM Studio Hub.",
  args: {
    ...logLevelArgs,
    ...createClientArgs,
    description: option({
      type: optional(string),
      long: "description",
      description: text`
        Description of the artifact. If provided, will overwrite the existing description.
      `,
    }),
    overrides: option({
      type: optional(overridesType),
      long: "overrides",
    }),
    yes: flag({
      type: boolean,
      long: "yes",
      short: "y",
      description: text`
        Suppress all confirmations and warnings.
      `,
    }),
    makePrivate: flag({
      type: boolean,
      long: "private",
      description: text`
        When specified, the published artifact will be marked as private. This flag is only
        effective if the artifact did not exist before. (It will not change the visibility of an
        existing artifact.)
      `,
    }),
    writeRevision: flag({
      type: boolean,
      long: "write-revision",
      description: text`
        When specified, the revision number will be written to the manifest.json file. This is
        useful if you want to keep track of the revision number in your source control.
      `,
    }),
  },
  handler: async args => {
    const logger = createLogger(args);
    const client = await createClient(logger, args);
    const { yes, description, overrides, writeRevision, makePrivate } = args;
    const currentPath = cwd();
    await maybeGenerateManifestJson(logger, currentPath);
    const projectPath = await findProjectFolderOrExit(logger, currentPath);

    const manifestJsonPath = join(projectPath, "manifest.json");
    const manifestContent = await readFile(manifestJsonPath, "utf-8");
    const manifest = artifactManifestSchema.parse(JSON.parse(manifestContent));
    // For now, we only require user to confirm if the manifest type is plugin.
    const needsConfirmation = !args.yes && manifest.type === "plugin";

    if (manifest.owner === "local") {
      logger.error("This artifact was created without a username.");
      logger.error(
        "Please edit the manifest.json and set the owner field to your LM Studio Hub username.",
      );
      process.exit(1);
    }

    await ensureAuthenticated(client, logger, { yes });

    const fileList = await client.repository.getLocalArtifactFileList(projectPath);
    printFileList(fileList, logger);

    if (needsConfirmation) {
      if (!(await askQuestion("Continue?"))) {
        logger.info("Aborting push.");
        process.exit(1);
      }
    }

    await client.repository.pushArtifact({
      path: projectPath,
      description,
      writeRevision,
      makePrivate,
      overrides,
      onMessage: message => logger.info(message),
    });
  },
});

function printFileList(fileList: LocalArtifactFileList, logger: SimpleLogger) {
  logger.info();
  logger.info("The following files will be pushed:");
  logger.info();
  for (const file of fileList.files) {
    logger.info(
      `   ${file.relativePath} ${chalk.gray(`(${formatSizeBytes1000(file.sizeBytes)})`)}`,
    );
  }
  logger.info();
  if (fileList.usedIgnoreFile) {
    logger.info(chalk.gray(`(Used ignore file ${fileList.usedIgnoreFile})`));
  } else {
    logger.info(
      chalk.gray(text`
        (i) You can create a ${chalk.yellow(".lmsignore")} or ${chalk.yellow(".gitignore")} file to
        filter out unwanted files.
      `),
    );
  }
  logger.info();
}

/**
 * Currently a temporary function that generates manifest.json file if there is a model.yaml file in
 * in the directory.
 */
async function maybeGenerateManifestJson(logger: SimpleLogger, folderPath: string) {
  const modelYamlPath = join(folderPath, "model.yaml");
  if (await exists(modelYamlPath)) {
    logger.debug("Found model.yaml, generating manifest.json");
    await generateManifestJsonFromModelYaml(folderPath, modelYamlPath);
  }
}

/**
 * Parses the artifact identifier to get the owner and name. Throws an error if the identifier is
 * not valid.
 *
 * @param artifactIdentifier - The artifact identifier to parse.
 * @param fieldName - The name of the field to use in the error message.
 */
function parseArtifactIdentifierToOwnerName(
  artifactIdentifier: string,
  fieldName: string,
): readonly [string, string] {
  const [owner, name] = artifactIdentifier.split("/");
  if (
    owner === undefined ||
    name === undefined ||
    !kebabCaseRegex.test(owner) ||
    !kebabCaseWithDotsRegex.test(name)
  ) {
    throw new Error(`Invalid ${fieldName}: ${artifactIdentifier}`);
  }
  return [owner, name] as const;
}

async function generateManifestJsonFromModelYaml(folderPath: string, modelYamlPath: string) {
  const virtualModelDefinitionFileContent = await readFile(modelYamlPath, "utf-8");
  const virtualModelDefinition = virtualModelDefinitionSchema.parse(
    YAML.parse(virtualModelDefinitionFileContent),
  );
  const manifestJsonPath = join(folderPath, "manifest.json");

  const [owner, name] = parseArtifactIdentifierToOwnerName(virtualModelDefinition.model, "model");

  const dependencies: Array<ArtifactDependency> = [];

  if (typeof virtualModelDefinition.base === "string") {
    // If a string is specified, it depends on a virtual model.
    const [baseOwner, baseName] = parseArtifactIdentifierToOwnerName(
      virtualModelDefinition.base,
      "base",
    );
    dependencies.push({
      type: "artifact",
      owner: baseOwner,
      name: baseName,
      purpose: "baseModel",
    });
  } else {
    // An array of concrete models is specified.
    const modelKeys: Array<string> = [];
    const sources: Array<ModelDownloadSource> = [];
    for (const concreteModelBase of virtualModelDefinition.base) {
      modelKeys.push(concreteModelBase.key);
      sources.push(...concreteModelBase.sources);
    }
    dependencies.push({
      type: "model",
      modelKeys,
      sources,
      purpose: "baseModel",
    });
  }

  const manifest: ModelManifest = {
    type: "model",
    owner,
    name,
    dependencies,
    tags: virtualModelDefinition.tags,
  };

  await writeFile(manifestJsonPath, JSON.stringify(manifest, null, 2), "utf-8");
}
