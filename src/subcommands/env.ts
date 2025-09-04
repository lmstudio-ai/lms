import { Command } from "@commander-js/extra-typings";
import { text } from "@lmstudio/lms-common";
import { EnvironmentManager } from "../EnvironmentManager.js";
import { addLogLevelOptions, createLogger } from "../logLevel.js";
import { createRefinedNumberParser } from "../types/refinedNumber.js";

const portParser = createRefinedNumberParser({ integer: true, min: 0, max: 65535 });

const addEnvCommand = addLogLevelOptions(
  new Command()
    .name("add")
    .description("Add a new environment")
    .argument("<name>", "Environment name")
    .requiredOption("--host <host>", "Host address")
    .requiredOption("--port <port>", "Port number", portParser)
    .option("--description <description>", "Environment description"),
).action(async (name, options) => {
  const logger = createLogger(options);
  const envManager = new EnvironmentManager(logger);
  try {
    await envManager.addEnvironment({
      name,
      host: options.host,
      port: options.port,
      description: options.description,
    });
    logger.info(`Environment '${name}' added successfully`);
  } catch (error) {
    logger.error(`Failed to add environment: ${(error as Error).message}`);
    process.exit(1);
  }
});

const removeEnvCommand = addLogLevelOptions(
  new Command()
    .name("remove")
    .description("Remove an environment")
    .argument("<name>", "Environment name to remove"),
).action(async (name, options) => {
  const logger = createLogger(options);
  const envManager = new EnvironmentManager(logger);
  try {
    await envManager.removeEnvironment(name);
    logger.info(`Environment '${name}' removed successfully`);
  } catch (error) {
    logger.error(`Failed to remove environment: ${(error as Error).message}`);
    process.exit(1);
  }
});

const listEnvCommand = addLogLevelOptions(
  new Command().name("ls").description("List all environments"),
).action(async options => {
  const logger = createLogger(options);
  const envManager = new EnvironmentManager(logger);
  try {
    const environments = await envManager.getAllEnvironments();
    const current = await envManager.getCurrentEnvironment();

    if (environments.length === 0) {
      logger.info("No environments found");
      return;
    }

    logger.info("Available environments:");
    for (const env of environments) {
      const isCurrent = env.name === current.name;
      const marker = isCurrent ? "* " : "  ";
      const desc = env.description !== undefined ? ` - ${env.description}` : "";
      logger.info(`${marker}${env.name} (${env.host}:${env.port})${desc}`);
    }

    // Show default local environment if not in list
    const hasLocal = environments.some(env => env.name === "local");
    if (!hasLocal) {
      const marker = current.name === "local" ? "* " : "  ";
      logger.info(`${marker}local (localhost:1234) - Default local environment`);
    }
  } catch (error) {
    logger.error(`Failed to list environments: ${(error as Error).message}`);
    process.exit(1);
  }
});

const useEnvCommand = addLogLevelOptions(
  new Command()
    .name("use")
    .description("Switch to an environment")
    .argument("<name>", "Environment name to switch to"),
).action(async (name, options) => {
  const logger = createLogger(options);
  const envManager = new EnvironmentManager(logger);
  try {
    await envManager.setCurrentEnvironment(name);
    logger.info(`Switched to environment '${name}'`);
  } catch (error) {
    logger.error(`Failed to switch environment: ${(error as Error).message}`);
    process.exit(1);
  }
});

const currentEnvCommand = addLogLevelOptions(
  new Command().name("current").description("Show current environment"),
).action(async options => {
  const logger = createLogger(options);
  const envManager = new EnvironmentManager(logger);
  try {
    const current = await envManager.getCurrentEnvironment();
    const desc = current.description !== undefined ? ` - ${current.description}` : "";
    logger.info(`Current environment: ${current.name} (${current.host}:${current.port})${desc}`);
  } catch (error) {
    logger.error(`Failed to get current environment: ${(error as Error).message}`);
    process.exit(1);
  }
});

const inspectEnvCommand = addLogLevelOptions(
  new Command()
    .name("inspect")
    .description("Show detailed information about an environment")
    .argument("<name>", "Environment name to inspect"),
).action(async (name, options) => {
  const logger = createLogger(options);
  const envManager = new EnvironmentManager(logger);
  try {
    const env = await envManager.tryGetEnvironment(name);
    if (!env) {
      logger.error(`Environment '${name}' not found`);
      process.exit(1);
    }

    logger.info(`Environment: ${env.name}`);
    logger.info(`Host: ${env.host}`);
    logger.info(`Port: ${env.port}`);
    if (env.description !== undefined) {
      logger.info(`Description: ${env.description}`);
    }
  } catch (error) {
    logger.error(`Failed to inspect environment: ${(error as Error).message}`);
    process.exit(1);
  }
});

export const env = new Command()
  .name("env")
  .description(
    text`
    Manage LM Studio environments. Environments allow you to switch between different
    LM Studio instances (local or remote) easily.
  `,
  )
  .addCommand(addEnvCommand)
  .addCommand(removeEnvCommand)
  .addCommand(listEnvCommand)
  .addCommand(useEnvCommand)
  .addCommand(currentEnvCommand)
  .addCommand(inspectEnvCommand);
