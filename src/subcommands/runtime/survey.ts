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
import { formatSizeBytes1000 } from "../../formatSizeBytes1000.js";

interface RuntimeSurveyCommandOptions {
  all: boolean;
  refresh: boolean;
  json: boolean;
}

interface GpuMemoryMetrics {
  totalBytes: number;
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
  const totalText = formatSizeBytes1000(memoryMetrics.totalBytes);
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
    return {
      device: deviceDescriptor,
      vram: formatMemoryRatio(memoryMetrics),
    };
  });

  return columnify(rows, {
    columns: ["device", "vram"],
    config: {
      device: { headingTransform: () => chalk.grey("GPU/ACCELERATORS"), align: "left" },
      vram: { headingTransform: () => chalk.grey("VRAM"), align: "left" },
    },
    columnSplitter: "   ",
  });
}

function renderCombinedGpuTable(engines: RuntimeHardwareSurveyEngine[]): {
  table: string | undefined;
  hasFailures: boolean;
} {
  const rows: Array<{
    engine: string;
    device: string;
    vram: string;
    cpu: string;
    ram: string;
    status: string;
  }> = [];

  const maxStatusLength = 60;
  let hasFailures = false;

  for (const engineSurvey of engines) {
    const gpus = engineSurvey.hardwareSurvey.gpuSurveyResult.gpuInfo;
    const engineLabel = `${engineSurvey.engine}-${engineSurvey.version}`;

    let statusText =
      engineSurvey.compatibility.status === "Compatible"
        ? "Compatible"
        : engineSurvey.compatibility.message !== undefined
          ? `${engineSurvey.compatibility.status}: ${engineSurvey.compatibility.message}`
          : engineSurvey.compatibility.status;

    if (engineSurvey.compatibility.status !== "Compatible") {
      hasFailures = true;
    }

    if (statusText.length > maxStatusLength) {
      statusText = statusText.substring(0, maxStatusLength - 3) + "...";
    }

    const cpuInfo = engineSurvey.hardwareSurvey.cpuSurveyResult.cpuInfo;
    const cpuText =
      cpuInfo === undefined
        ? "No CPU detected"
        : cpuInfo.supportedInstructionSetExtensions.length > 0
          ? `${cpuInfo.architecture} (${cpuInfo.supportedInstructionSetExtensions.join(", ")})`
          : cpuInfo.architecture;

    const ramCapacity = engineSurvey.memoryInfo.ramCapacity;
    const ramText = ramCapacity === 0 ? "-" : formatSizeBytes1000(ramCapacity);

    if (gpus.length === 0) {
      rows.push({
        engine: engineLabel,
        device: "No GPUs detected",
        vram: "-",
        cpu: cpuText,
        ram: ramText,
        status: statusText,
      });
    } else {
      for (const gpuInfo of gpus) {
        const memoryMetrics = getGpuMemoryMetrics(gpuInfo);
        const deviceDescriptor = `${gpuInfo.name} (${gpuInfo.detectionPlatform}, ${gpuInfo.integrationType})`;
        rows.push({
          engine: engineLabel,
          device: deviceDescriptor,
          vram: formatMemoryRatio(memoryMetrics),
          cpu: cpuText,
          ram: ramText,
          status: statusText,
        });
      }
    }
  }

  const table = columnify(rows, {
    columns: ["engine", "device", "vram", "cpu", "ram", "status"],
    config: {
      engine: { headingTransform: () => chalk.grey("ENGINE"), align: "left" },
      device: { headingTransform: () => chalk.grey("GPU/ACCELERATORS"), align: "left" },
      vram: { headingTransform: () => chalk.grey("VRAM"), align: "left" },
      cpu: { headingTransform: () => chalk.grey("CPU"), align: "left" },
      ram: { headingTransform: () => chalk.grey("RAM"), align: "left" },
      status: { headingTransform: () => chalk.grey("STATUS"), align: "left" },
    },
    columnSplitter: "   ",
  });

  return { table, hasFailures };
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
  const ramCapacityText = formatSizeBytes1000(survey.memoryInfo.ramCapacity);

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
    if (commandOptions.all) {
      const { table } = renderCombinedGpuTable(surveyResult.engines);
      if (table !== undefined) {
        logger.info(table);
      }
      return;
    }
    const engineSurvey = surveyResult.engines[0];
    renderEngineSurvey(engineSurvey, logger);
    logger.info("");
  });

addCreateClientOptions(surveyCommand);
addLogLevelOptions(surveyCommand);

export const survey = surveyCommand;
