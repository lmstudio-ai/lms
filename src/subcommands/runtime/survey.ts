import { Command } from "@commander-js/extra-typings";
import {
  type RuntimeHardwareGpuDetectionPlatform,
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

function renderGpuTable(gpuInfos: RuntimeHardwareGpuInfo[]): string | undefined {
  if (gpuInfos.length === 0) {
    return undefined;
  }

  const rows = gpuInfos.map(gpuInfo => {
    const memoryMetrics = getGpuMemoryMetrics(gpuInfo);
    const deviceDescriptor = `${gpuInfo.name} (${gpuInfo.integrationType})`;
    const driverVersion =
      gpuInfo.detectionPlatformVersion !== "" ? gpuInfo.detectionPlatformVersion : "Unknown";
    return {
      device: deviceDescriptor,
      detectionPlatform: gpuInfo.detectionPlatform,
      vram: formatMemoryRatio(memoryMetrics),
      driver: driverVersion,
    };
  });

  return columnify(rows, {
    columns: ["device", "detectionPlatform", "vram", "driver"],
    config: {
      device: { headingTransform: () => chalk.grey("GPU/ACCELERATORS"), align: "left" },
      detectionPlatform: {
        headingTransform: () => chalk.grey("DETECTION PLATFORM"),
        align: "left",
      },
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

function renderEngineSurvey(surveyResult: RuntimeHardwareSurveyResult, logger: SimpleLogger): void {
  const aggregatedGpuInfos: RuntimeHardwareGpuInfo[] = [];
  const usedDetectionPlatforms = new Set<RuntimeHardwareGpuDetectionPlatform>();

  for (const engineSurvey of surveyResult.engines) {
    const gpuInfosByPlatform = new Map<
      RuntimeHardwareGpuDetectionPlatform,
      RuntimeHardwareGpuInfo[]
    >();

    for (const gpuInfo of engineSurvey.hardwareSurvey.gpuSurveyResult.gpuInfo) {
      const platformGpuInfos = gpuInfosByPlatform.get(gpuInfo.detectionPlatform) ?? [];
      platformGpuInfos.push(gpuInfo);
      gpuInfosByPlatform.set(gpuInfo.detectionPlatform, platformGpuInfos);
    }

    for (const [detectionPlatform, platformGpuInfos] of gpuInfosByPlatform) {
      if (usedDetectionPlatforms.has(detectionPlatform) === true) {
        continue;
      }
      usedDetectionPlatforms.add(detectionPlatform);
      for (const platformGpuInfo of platformGpuInfos) {
        aggregatedGpuInfos.push(platformGpuInfo);
      }
    }
  }

  const gpuTable = renderGpuTable(aggregatedGpuInfos);
  if (gpuTable === undefined) {
    logger.info("No accelerators detected.");
  } else {
    logger.info(gpuTable);
  }
  const firstEngineSurvey = surveyResult.engines[0];
  logger.info("\n" + renderCpuLine(firstEngineSurvey));
  logger.info(renderRamLine(firstEngineSurvey));

  const compatibilityLine = renderCompatibilityLine(firstEngineSurvey);
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
    // Aggregate GPU information across all engines so that GPUs detected
    // via different platforms are shown together in a single table.
    // For CPU, RAM, and compatibility we use the first engine survey..
    renderEngineSurvey(surveyResult, logger);
  });

addCreateClientOptions(surveyCommand);
addLogLevelOptions(surveyCommand);

export const survey = surveyCommand;
