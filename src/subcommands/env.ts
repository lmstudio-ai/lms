import { text } from "@lmstudio/lms-common";
import { command, option, optional, positional, string, subcommands } from "cmd-ts";
import { EnvironmentManager } from "../EnvironmentManager.js";
import { createLogger, logLevelArgs } from "../logLevel.js";
import { refinedNumber } from "../types/refinedNumber.js";

const addEnvCommand = command({
  name: "add",
  description: "Add a new environment",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Environment name",
    }),
    host: option({
      type: string,
      long: "host",
      description: "Host address",
    }),
    port: option({
      type: refinedNumber({ integer: true, min: 0, max: 65535 }),
      long: "port",
      description: "Port number",
    }),
    description: option({
      type: optional(string),
      long: "description",
      description: "Environment description",
    }),
    ...logLevelArgs,
  },
  handler: async ({ name, host, port, description, ...logArgs }) => {
    const logger = createLogger(logArgs);
    const envManager = new EnvironmentManager();
    try {
      await envManager.addEnvironment({
        name,
        host,
        port,
        description,
      });
      logger.info(`Environment '${name}' added successfully`);
    } catch (error) {
      logger.error(`Failed to add environment: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});

const removeEnvCommand = command({
  name: "remove",
  description: "Remove an environment",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Environment name to remove",
    }),
    ...logLevelArgs,
  },
  handler: async ({ name, ...logArgs }) => {
    const logger = createLogger(logArgs);
    const envManager = new EnvironmentManager();
    try {
      await envManager.removeEnvironment(name);
      logger.info(`Environment '${name}' removed successfully`);
    } catch (error) {
      logger.error(`Failed to remove environment: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});

const listEnvCommand = command({
  name: "ls",
  description: "List all environments",
  args: {
    ...logLevelArgs,
  },
  handler: async logArgs => {
    const logger = createLogger(logArgs);
    const envManager = new EnvironmentManager();
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
        const desc = env.description ? ` - ${env.description}` : "";
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
  },
});

const useEnvCommand = command({
  name: "use",
  description: "Switch to an environment",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Environment name to switch to",
    }),
    ...logLevelArgs,
  },
  handler: async ({ name, ...logArgs }) => {
    const logger = createLogger(logArgs);
    const envManager = new EnvironmentManager();
    try {
      if (name === "local") {
        // Special case for local environment
        process.env.LMS_ENV = "local";
        logger.info("Switched to local environment");
        return;
      }

      await envManager.setCurrentEnvironment(name);
      logger.info(`Switched to environment '${name}'`);
    } catch (error) {
      logger.error(`Failed to switch environment: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});

const currentEnvCommand = command({
  name: "current",
  description: "Show current environment",
  args: {
    ...logLevelArgs,
  },
  handler: async logArgs => {
    const logger = createLogger(logArgs);
    const envManager = new EnvironmentManager();
    try {
      const current = await envManager.getCurrentEnvironment();
      const desc = current.description ? ` - ${current.description}` : "";
      logger.info(`Current environment: ${current.name} (${current.host}:${current.port})${desc}`);
    } catch (error) {
      logger.error(`Failed to get current environment: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});

export const env = subcommands({
  name: "env",
  description: text`
    Manage LM Studio environments. Environments allow you to switch between different
    LM Studio instances (local or remote) easily.
  `,
  cmds: {
    add: addEnvCommand,
    remove: removeEnvCommand,
    ls: listEnvCommand,
    use: useEnvCommand,
    current: currentEnvCommand,
  },
});
