import { readFile, writeFile, mkdir, access, unlink, readdir } from "fs/promises";
import { join } from "path";
import { lmsConfigFolder } from "./lmstudioPaths.js";
import { z } from "zod";
import { type SimpleLogger } from "@lmstudio/lms-common";
const environmentConfigSchema = z.object({
  name: z.string(),
  host: z.string(),
  port: z.number().int().min(0).max(65535),
  description: z.string().optional(),
});

export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;

export const DEFAULT_LOCAL_ENVIRONMENT_NAME = "local";

const DEFAULT_ENVIRONMENT_CONFIG: EnvironmentConfig = {
  name: DEFAULT_LOCAL_ENVIRONMENT_NAME,
  host: "localhost",
  port: 1234,
  description: "Default local environment",
};

export class EnvironmentManager {
  private environmentsDir: string;
  private currentEnvFile: string;

  public constructor(private readonly logger: SimpleLogger) {
    const configDir = lmsConfigFolder;
    this.environmentsDir = join(configDir, "environments");
    this.currentEnvFile = join(configDir, "current-env");
  }

  private async ensureDirExists(): Promise<void> {
    await mkdir(this.environmentsDir, { recursive: true });
  }

  public async addEnvironment(config: EnvironmentConfig): Promise<void> {
    await this.ensureDirExists();
    const envPath = join(this.environmentsDir, `${config.name}.json`);
    try {
      await access(envPath);
      throw new Error(`Environment ${config.name} already exists.`);
    } catch {
      await writeFile(envPath, JSON.stringify(config, null, 2), "utf-8");
    }
  }

  public async removeEnvironment(name: string): Promise<void> {
    const envPath = join(this.environmentsDir, `${name}.json`);
    try {
      await unlink(envPath);
      // Check if this was the current environment
      try {
        const currentEnv = await readFile(this.currentEnvFile, "utf-8");
        if (currentEnv === name) {
          await writeFile(this.currentEnvFile, DEFAULT_LOCAL_ENVIRONMENT_NAME, "utf-8");
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          await writeFile(this.currentEnvFile, DEFAULT_LOCAL_ENVIRONMENT_NAME, "utf-8");
        } else {
          // Re-throw other types of errors
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(`Environment ${name} does not exist.`);
      } else {
        throw new Error(`Failed to remove environment ${name}: ${(error as Error).message}`);
      }
    }
  }

  public async setCurrentEnvironment(name: string): Promise<void> {
    if (name === "local") {
      // Special case for local environment
      await writeFile(this.currentEnvFile, DEFAULT_LOCAL_ENVIRONMENT_NAME, "utf-8");
      return;
    }
    const envPath = join(this.environmentsDir, `${name}.json`);
    try {
      const data = await readFile(envPath, "utf-8");
      environmentConfigSchema.parse(JSON.parse(data)); // Validate schema
      await writeFile(this.currentEnvFile, name, "utf-8");
    } catch {
      throw new Error(`Environment ${name} does not exist.`);
    }
  }

  public async getCurrentEnvironment(): Promise<EnvironmentConfig> {
    let envName: string;

    // Check if LMS_ENV is set in the environment variables
    // This takes precedence over the currentEnvFile
    if (
      process.env.LMS_ENV &&
      process.env.LMS_ENV !== "undefined" &&
      process.env.LMS_ENV !== "null"
    ) {
      envName = process.env.LMS_ENV;
    } else {
      try {
        envName = (await readFile(this.currentEnvFile, "utf-8")).trim();
      } catch {
        envName = DEFAULT_LOCAL_ENVIRONMENT_NAME;
      }
    }
    if (envName === undefined || envName === "" || envName === DEFAULT_LOCAL_ENVIRONMENT_NAME) {
      return DEFAULT_ENVIRONMENT_CONFIG;
    }

    const env = await this.tryGetEnvironment(envName);
    if (env === undefined) {
      this.logger.warn(`Environment ${envName} not found, falling back to local.`);
      await writeFile(this.currentEnvFile, DEFAULT_LOCAL_ENVIRONMENT_NAME, "utf-8");
      return DEFAULT_ENVIRONMENT_CONFIG;
    }

    return env;
  }

  public async getAllEnvironments(): Promise<EnvironmentConfig[]> {
    await this.ensureDirExists();
    const files = await readdir(this.environmentsDir);
    const environments: EnvironmentConfig[] = [DEFAULT_ENVIRONMENT_CONFIG];
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const data = await readFile(join(this.environmentsDir, file), "utf-8");
          const parsed = environmentConfigSchema.parse(JSON.parse(data));
          environments.push(parsed);
        } catch (error) {
          this.logger.error(`Failed to load environment from ${file}: ${(error as Error).message}`);
        }
      }
    }
    return environments;
  }

  public async tryGetEnvironment(name: string): Promise<EnvironmentConfig | undefined> {
    if (name === DEFAULT_LOCAL_ENVIRONMENT_NAME) {
      return DEFAULT_ENVIRONMENT_CONFIG; // Return default local environment
    }
    await this.ensureDirExists();
    const envPath = join(this.environmentsDir, `${name}.json`);
    try {
      const data = await readFile(envPath, "utf-8");
      return environmentConfigSchema.parse(JSON.parse(data));
    } catch {
      return undefined; // Environment does not exist
    }
  }
}
