import { type SimpleLogger } from "@lmstudio/lms-common";
import {
  type ArtifactDependency,
  kebabCaseRegex,
  kebabCaseWithDotsRegex,
  type ModelDownloadSource,
  type ModelManifest,
  virtualModelDefinitionSchema,
} from "@lmstudio/lms-shared-types";
import { command } from "cmd-ts";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { cwd } from "process";
import YAML from "yaml";
import { createClient, createClientArgs } from "../createClient.js";
import { ensureAuthenticated } from "../ensureAuthenticated.js";
import { exists } from "../exists.js";
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
    await ensureAuthenticated(client, logger);
    const currentPath = cwd();
    await maybeGenerateManifestJson(logger, currentPath);
    const projectPath = await findProjectFolderOrExit(logger, currentPath);
    await client.repository.pushArtifact({
      path: projectPath,
      onMessage: message => logger.info(message),
    });
  },
});

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
    description: virtualModelDefinition.description ?? "",
    dependencies,
    tags: virtualModelDefinition.tags,
  };

  await writeFile(manifestJsonPath, JSON.stringify(manifest, null, 2), "utf-8");
}
