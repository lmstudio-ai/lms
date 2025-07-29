import { promises as fs } from "fs";
import { join } from "path";
import { lmsConfigFolder } from "./lmstudioPaths.js";

interface EnvironmentConfig {
  name: string;
  host: string;
  port: number;
  description?: string;
  executablePath?: string;
}

const DEFAULT_ENVIRONMENT_CONFIG: EnvironmentConfig = {
  name: "local",
  host: "localhost",
  port: 1234,
  description: "Default local environment",
};

export class EnvironmentManager {
  private environmentsDir: string;
  private currentEnvFile: string;

  public constructor() {
    const configDir = lmsConfigFolder;
    this.environmentsDir = join(configDir, "environments");
    this.currentEnvFile = join(configDir, "current-env");
  }

  private async ensureDirExists(): Promise<void> {
    await fs.mkdir(this.environmentsDir, { recursive: true });
  }

  public async addEnvironment(config: EnvironmentConfig): Promise<void> {
    await this.ensureDirExists();
    const envPath = join(this.environmentsDir, `${config.name}.json`);
    try {
      await fs.access(envPath);
      throw new Error(`Environment ${config.name} already exists.`);
    } catch {
      await fs.writeFile(envPath, JSON.stringify(config, null, 2), "utf-8");
    }
  }

  public async removeEnvironment(name: string): Promise<void> {
    const envPath = join(this.environmentsDir, `${name}.json`);
    try {
      await fs.unlink(envPath);
      // Check if this was the current environment
      try {
        const currentEnv = await fs.readFile(this.currentEnvFile, "utf-8");
        if (currentEnv === name) {
          await fs.writeFile(this.currentEnvFile, "local", "utf-8");
          process.env.LMS_ENV = "local";
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          await fs.writeFile(this.currentEnvFile, "local", "utf-8");
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
    const envPath = join(this.environmentsDir, `${name}.json`);
    try {
      const data = await fs.readFile(envPath, "utf-8");
      JSON.parse(data) as EnvironmentConfig; // Validate exists
      await fs.writeFile(this.currentEnvFile, name, "utf-8");
    } catch {
      throw new Error(`Environment ${name} does not exist.`);
    }
  }

  public async getCurrentEnvironment(): Promise<EnvironmentConfig> {
    let envName: string;

    if (process.env.LMS_ENV) {
      envName = process.env.LMS_ENV;
    } else {
      try {
        envName = (await fs.readFile(this.currentEnvFile, "utf-8")).trim();
      } catch {
        envName = "local";
      }
    }
    if (envName === undefined || envName === "" || envName === "local") {
      return DEFAULT_ENVIRONMENT_CONFIG;
    }

    const env = await this.tryGetEnvironment(envName);
    if (env === undefined) {
      console.warn(`Environment ${envName} not found, falling back to local.`);
      await fs.writeFile(this.currentEnvFile, "local", "utf-8");
      return DEFAULT_ENVIRONMENT_CONFIG;
    }

    return env;
  }

  public async getAllEnvironments(): Promise<EnvironmentConfig[]> {
    await this.ensureDirExists();
    const files = await fs.readdir(this.environmentsDir);
    const environments: EnvironmentConfig[] = [DEFAULT_ENVIRONMENT_CONFIG];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const data = await fs.readFile(join(this.environmentsDir, file), "utf-8");
        environments.push(JSON.parse(data) as EnvironmentConfig);
      }
    }
    return environments;
  }

  public async tryGetEnvironment(name: string): Promise<EnvironmentConfig | undefined> {
    await this.ensureDirExists();
    const envPath = join(this.environmentsDir, `${name}.json`);
    try {
      const data = await fs.readFile(envPath, "utf-8");
      return JSON.parse(data) as EnvironmentConfig;
    } catch {
      return undefined; // Environment does not exist
    }
  }
}
