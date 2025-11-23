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

interface RuntimeSurveyCommandOptions {
  all: boolean;
  refresh: boolean;
  json: boolean;
}

interface GpuMemoryMetrics {
  usedBytes?: number;
  freeBytes?: number;
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

function parseMaybeNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

function getGpuMemoryMetrics(gpuInfo: RuntimeHardwareGpuInfo): GpuMemoryMetrics {
  const totalBytes =
    gpuInfo.dedicatedMemoryCapacityBytes > 0
      ? gpuInfo.dedicatedMemoryCapacityBytes
      : gpuInfo.totalMemoryCapacityBytes;
  const freeBytes =
    parseMaybeNumber(gpuInfo.otherInfo["freeVramBytes"]) ??
    parseMaybeNumber(gpuInfo.otherInfo["free_memory_bytes"]);
  const usedBytesFromOtherInfo =
    parseMaybeNumber(gpuInfo.otherInfo["usedVramBytes"]) ??
    parseMaybeNumber(gpuInfo.otherInfo["occupiedVramBytes"]);
  const usedBytes =
    usedBytesFromOtherInfo !== undefined
      ? usedBytesFromOtherInfo
      : freeBytes !== undefined
        ? Math.max(totalBytes - freeBytes, 0)
        : undefined;
  return {
    usedBytes,
    freeBytes,
    totalBytes,
  };
}

function formatMemoryRatio(memoryMetrics: GpuMemoryMetrics): string {
  const usedText =
    memoryMetrics.usedBytes !== undefined ? formatBytes(memoryMetrics.usedBytes) : "--";
  const freeText =
    memoryMetrics.freeBytes !== undefined ? formatBytes(memoryMetrics.freeBytes) : "--";
  const totalText = formatBytes(memoryMetrics.totalBytes);
  return `${usedText} / ${freeText} / ${totalText}`;
}

function resolveScope(options: RuntimeSurveyCommandOptions): RuntimeHardwareSurveyScope | undefined {
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
      device: { headingTransform: () => "DEVICE", align: "left" },
      vram: { headingTransform: () => "VRAM (used/free/total)", align: "left" },
      driver: { headingTransform: () => "DRIVER", align: "left" },
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
  const ramCapacityText = formatBytes(survey.memoryInfo.ramCapacity);
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

function renderEngineSurvey(
  survey: RuntimeHardwareSurveyEngine,
  logger: SimpleLogger,
) {
  const gpuTable = renderGpuTable(survey);
  if (gpuTable === undefined) {
    logger.info("GPU/ACCELERATOR SURVEY");
    logger.info("No accelerators detected.");
  } else {
    logger.info("GPU/ACCELERATOR SURVEY");
    logger.info(gpuTable);
  }
  logger.info(renderCpuLine(survey));
  logger.info(renderRamLine(survey));

  const compatibilityLine = renderCompatibilityLine(survey);
  if (compatibilityLine !== undefined) {
    logger.info(compatibilityLine);
  }

  logger.info(
    `Survey using ${survey.name}@${survey.version} (${survey.platform})`,
  );
}

async function runSurvey(
  client: LMStudioClient,
  options: RuntimeSurveyCommandOptions,
): Promise<RuntimeHardwareSurveyResult> {
  const scope = resolveScope(options);
  return await client.runtime.surveyHardware(scope);
}

export const survey = addLogLevelOptions(
  addCreateClientOptions(
    new Command()
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
      }),
  ),
);
