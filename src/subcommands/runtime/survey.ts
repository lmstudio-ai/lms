import { Command } from "@commander-js/extra-typings";
import {
  type RuntimeHardwareGpuInfo,
  type RuntimeHardwareSurveyEngine,
  type RuntimeHardwareSurveyResult,
  type RuntimeHardwareSurveyScope,
} from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import columnify from "columnify";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { addCreateClientOptions, createClient } from "../../createClient.js";
import { addLogLevelOptions, createLogger } from "../../logLevel.js";
import { UserInputError } from "../../types/UserInputError.js";
import chalk from "chalk";

interface RuntimeSurveyCommandOptions {
  all: boolean;
  refresh: boolean;
  json: boolean;
}

interface GpuMemoryMetrics {
  totalBytes: number;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) {
    return "n/a";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let currentValue = bytes;
  let unitIndex = 0;
  while (currentValue >= 1024 && unitIndex < units.length - 1) {
    currentValue /= 1024;
    unitIndex += 1;
  }
  return `${currentValue.toFixed(1)} ${units[unitIndex]}`;
}

function getGpuMemoryMetrics(gpuInfo: RuntimeHardwareGpuInfo): GpuMemoryMetrics {
  const totalBytes =
    gpuInfo.dedicatedMemoryCapacityBytes > 0
      ? gpuInfo.dedicatedMemoryCapacityBytes
      : gpuInfo.totalMemoryCapacityBytes;
  return {
    totalBytes,
  };
}

function formatMemoryRatio(memoryMetrics: GpuMemoryMetrics): string {
  const totalText = formatBytes(memoryMetrics.totalBytes);
  return ` ${totalText}`;
}

function resolveScope(
  options: RuntimeSurveyCommandOptions,
): RuntimeHardwareSurveyScope | undefined {
  if (options.all === true && options.refresh === true) {
    throw new UserInputError("Flags --all and --refresh cannot be used together.");
  }
  if (options.all === true) {
    return { type: "all" };
  }
  if (options.refresh === true) {
    return { type: "newAndSelected" };
  }
  return undefined;
}

function renderGpuTable(survey: RuntimeHardwareSurveyEngine): string | undefined {
  const gpus = survey.hardwareSurvey.gpuSurveyResult.gpuInfo;
  if (gpus.length === 0) {
    return undefined;
  }

  const rows = gpus.map(gpuInfo => {
    const memoryMetrics = getGpuMemoryMetrics(gpuInfo);
    const deviceDescriptor = `${gpuInfo.name} (${gpuInfo.detectionPlatform}, ${gpuInfo.integrationType})`;
    const driverVersion =
      gpuInfo.detectionPlatformVersion !== "" ? gpuInfo.detectionPlatformVersion : "Unknown";
    return {
      device: deviceDescriptor,
      vram: formatMemoryRatio(memoryMetrics),
      driver: driverVersion,
    };
  });

  return columnify(rows, {
    columns: ["device", "vram", "driver"],
    config: {
      device: { headingTransform: () => chalk.grey("GPU/ACCELERATORS"), align: "left" },
      vram: { headingTransform: () => chalk.grey("Total VRAM"), align: "left" },
      driver: { headingTransform: () => chalk.grey("DRIVER"), align: "left" },
    },
    columnSplitter: "   ",
  });
}

function renderCpuLine(survey: RuntimeHardwareSurveyEngine): string {
  const cpuInfo = survey.hardwareSurvey.cpuSurveyResult.cpuInfo;
  if (cpuInfo === undefined) {
    return "CPU: unavailable";
  }
  const instructionSetExtensions =
    cpuInfo.supportedInstructionSetExtensions.length > 0
      ? ` (${cpuInfo.supportedInstructionSetExtensions.join(", ")})`
      : "";
  return `CPU: ${cpuInfo.architecture}${instructionSetExtensions}`;
}

function renderRamLine(survey: RuntimeHardwareSurveyEngine): string {
  const ramCapacityText = formatBytes(survey.memoryInfo.totalMemory);

  return `RAM: ${ramCapacityText}`;
}

function renderCompatibilityLine(survey: RuntimeHardwareSurveyEngine): string | undefined {
  if (survey.compatibility.status === "Compatible") {
    return undefined;
  }
  if (survey.compatibility.message === undefined) {
    return `Compatibility: ${survey.compatibility.status}`;
  }
  return `Compatibility: ${survey.compatibility.status} — ${survey.compatibility.message}`;
}

function renderEngineSurvey(survey: RuntimeHardwareSurveyEngine, logger: SimpleLogger) {
  const gpuTable = renderGpuTable(survey);
  logger.info(
    chalk.gray(`Survey by ${survey.engine} [${survey.gpuFramework}] (${survey.version}):`),
  );
  if (gpuTable === undefined) {
    logger.info("No accelerators detected.");
  } else {
    logger.info(gpuTable);
  }
  logger.info("\n" + renderCpuLine(survey));
  logger.info(renderRamLine(survey));

  const compatibilityLine = renderCompatibilityLine(survey);
  if (compatibilityLine !== undefined) {
    logger.info(compatibilityLine);
  }
}

async function runSurvey(
  client: LMStudioClient,
  options: RuntimeSurveyCommandOptions,
): Promise<RuntimeHardwareSurveyResult> {
  const scope = resolveScope(options);
  return await client.runtime.surveyHardware(scope);
}

const surveyCommand = new Command()
  .name("survey")
  .description("Survey hardware available to runtime engines")
  .option("--all", "Force a full resurvey of every installed runtime")
  .option("--refresh", "Resurvey selected and new runtimes")
  .option("--json", "Output the raw JSON response")
  .action(async function (commandOptions) {
    const parentOptions = this.parent?.opts() ?? {};
    const logger = createLogger(parentOptions);
    const client = await createClient(logger, parentOptions);

    const runtimeSurveyOptions: RuntimeSurveyCommandOptions = {
      all: commandOptions.all ?? false,
      refresh: commandOptions.refresh ?? false,
      json: commandOptions.json ?? false,
    };

    const surveyResult = await runSurvey(client, runtimeSurveyOptions);
    if (runtimeSurveyOptions.json === true) {
      logger.info(JSON.stringify(surveyResult, null, 2));
      return;
    }

    if (surveyResult.engines.length === 0) {
      logger.info("No runtime survey results.");
      return;
    }

    surveyResult.engines.forEach((engineSurvey, engineIndex) => {
      renderEngineSurvey(engineSurvey, logger);
      const isLast = engineIndex === surveyResult.engines.length - 1;
      if (!isLast) {
        logger.info();
      }
    });
  });

addCreateClientOptions(surveyCommand);
addLogLevelOptions(surveyCommand);

export const survey = surveyCommand;
