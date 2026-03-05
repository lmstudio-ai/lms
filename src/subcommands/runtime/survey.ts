import { Command, type OptionValues } from "@commander-js/extra-typings";
import {
  type RuntimeHardwareCpuArchitecture,
  type RuntimeHardwareGpuDetectionPlatform,
  type RuntimeHardwareGpuIntegrationType,
  type RuntimeHardwareGpuInfo,
  type RuntimeHardwareSurveyCompatibilityStatus,
  type RuntimeHardwareSurveyEngine,
  type RuntimeHardwareSurveyResult,
} from "@lmstudio/lms-shared-types";
import { type LMStudioClient } from "@lmstudio/sdk";
import chalk from "chalk";
import columnify from "columnify";
import { addCreateClientOptions, createClient, type CreateClientArgs } from "../../createClient.js";
import { formatSizeBytes1024 } from "../../formatBytes.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";

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

function getBackendCompatibilityStatusLabel(
  status: RuntimeHardwareSurveyCompatibilityStatus,
): string {
  switch (status) {
    case "compatible":
      return "Compatible";
    case "incompatibleAppVersion":
      return "Incompatible app version";
    case "incompatibleBackendVersion":
      return "Incompatible backend version";
    case "invalidCpuArchitecture":
      return "Invalid CPU architecture";
    case "invalidCpuInstructionSetExtensions":
      return "Invalid CPU instruction set extensions";
    case "cpuSurveyUnsuccessful":
      return "CPU survey unsuccessful";
    case "gpuSurveyUnsuccessful":
      return "GPU survey unsuccessful";
    case "gpuRequiredButNoneFound":
      return "GPU required but none found";
    case "gpuTargetsRequiredButNoneSpecified":
      return "GPU targets required but none specified";
    case "gpuDriverUnsupported":
      return "GPU driver unsupported";
    case "noSupportedGpus":
      return "No supported GPUs";
    case "incompatiblePlatform":
      return "Incompatible platform";
    case "libraryOutdated":
      return "Library outdated";
    case "invalidLibraryVersionFormat":
      return "Invalid library version format";
    case "missingLibraries":
      return "Missing libraries";
    case "errorSurveyingHardware":
      return "Error surveying hardware";
    case "errorCheckingCompatibility":
      return "Error checking compatibility";
    case "unknown":
      return "Unknown";
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
}

function getRuntimeHardwareCpuArchitectureLabel(
  architecture: RuntimeHardwareCpuArchitecture,
): string {
  switch (architecture) {
    case "x86_64":
      return "x86_64";
    case "ARM64":
      return "ARM64";
    case "unknown":
      return "Unknown";
    default: {
      const exhaustiveCheck: never = architecture;
      return exhaustiveCheck;
    }
  }
}

function getRuntimeHardwareGpuDetectionPlatformLabel(
  detectionPlatform: RuntimeHardwareGpuDetectionPlatform,
): string {
  switch (detectionPlatform) {
    case "unknown":
      return "Unknown";
    case "shell":
      return "Shell";
    case "ROCm":
      return "ROCm";
    case "CUDA":
      return "CUDA";
    case "OpenCl":
      return "OpenCl";
    case "Metal":
      return "Metal";
    case "Vulkan":
      return "Vulkan";
    default: {
      const exhaustiveCheck: never = detectionPlatform;
      return exhaustiveCheck;
    }
  }
}

function getRuntimeHardwareGpuIntegrationTypeLabel(
  integrationType: RuntimeHardwareGpuIntegrationType,
): string {
  switch (integrationType) {
    case "unknown":
      return "Unknown";
    case "integrated":
      return "Integrated";
    case "discrete":
      return "Discrete";
    default: {
      const exhaustiveCheck: never = integrationType;
      return exhaustiveCheck;
    }
  }
}

// For now, we just display total VRAM
function formatMemoryRatio(memoryMetrics: GpuMemoryMetrics): string {
  const totalText = formatSizeBytes1024(memoryMetrics.totalBytes);
  return ` ${totalText}`;
}

function renderGpuTable(survey: RuntimeHardwareSurveyEngine): string | undefined {
  const gpus = survey.hardwareSurvey.gpuSurveyResult.gpuInfo;
  if (gpus.length === 0) {
    return undefined;
  }

  const rows = gpus.map(gpuInfo => {
    const memoryMetrics = getGpuMemoryMetrics(gpuInfo);
    const detectionPlatformLabel = getRuntimeHardwareGpuDetectionPlatformLabel(
      gpuInfo.detectionPlatform,
    );
    const integrationTypeLabel = getRuntimeHardwareGpuIntegrationTypeLabel(
      gpuInfo.integrationType,
    );
    const deviceDescriptor = `${gpuInfo.name} (${detectionPlatformLabel}, ${integrationTypeLabel})`;
    return {
      device: deviceDescriptor,
      vram: formatMemoryRatio(memoryMetrics),
    };
  });

  return columnify(rows, {
    columns: ["device", "vram"],
    config: {
      device: { headingTransform: () => chalk.dim("GPU/ACCELERATORS"), align: "left" },
      vram: { headingTransform: () => chalk.dim("VRAM"), align: "left" },
    },
    columnSplitter: "   ",
  });
}

function renderCpuLine(survey: RuntimeHardwareSurveyEngine): string {
  const cpuInfo = survey.hardwareSurvey.cpuSurveyResult.cpuInfo;
  if (cpuInfo === undefined) {
    return `${chalk.dim("CPU:")} unavailable`;
  }
  const instructionSetExtensions =
    cpuInfo.supportedInstructionSetExtensions.length > 0
      ? ` (${cpuInfo.supportedInstructionSetExtensions.join(", ")})`
      : "";
  const architectureLabel = getRuntimeHardwareCpuArchitectureLabel(cpuInfo.architecture);
  return `${chalk.dim("CPU:")} ${architectureLabel}${instructionSetExtensions}`;
}

function renderRamLine(survey: RuntimeHardwareSurveyEngine): string {
  const ramCapacityText = formatSizeBytes1024(survey.memoryInfo.ramCapacity);

  return `${chalk.dim("RAM:")} ${ramCapacityText}`;
}

function renderCompatibilityLine(survey: RuntimeHardwareSurveyEngine): string | undefined {
  if (survey.compatibility.status === "compatible") {
    return undefined;
  }
  const statusLabel = getBackendCompatibilityStatusLabel(survey.compatibility.status);
  if (survey.compatibility.message === undefined) {
    return `Compatibility: ${statusLabel}`;
  }
  return `Compatibility: ${statusLabel} — ${survey.compatibility.message}`;
}

function renderEngineSurvey(survey: RuntimeHardwareSurveyEngine) {
  const gpuTable = renderGpuTable(survey);
  if (gpuTable === undefined) {
    console.info("No GPUs detected");
  } else {
    console.info(gpuTable);
  }
  console.info("\n" + renderCpuLine(survey));
  console.info(renderRamLine(survey));

  const compatibilityLine = renderCompatibilityLine(survey);
  if (compatibilityLine !== undefined) {
    console.info(compatibilityLine);
  }
}

async function runSurvey(
  client: LMStudioClient,
  refresh: boolean,
): Promise<RuntimeHardwareSurveyResult> {
  return await client.runtime.surveyHardware(refresh ? { type: "selected" } : undefined);
}

type SurveyCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    json?: true;
    refresh?: true;
  };

const surveyCommand = new Command<[], SurveyCommandOptions>()
  .name("survey")
  .description("Survey hardware available to selected runtime engines")
  .option("--json", "Output the raw JSON response")
  .option("--refresh", "Resurvey selected and new runtimes");
addCreateClientOptions(surveyCommand);
addLogLevelOptions(surveyCommand);

surveyCommand.action(async function (commandOptions) {
  const logger = createLogger(commandOptions);
  await using client = await createClient(logger, commandOptions);

  const surveyResult = await runSurvey(client, commandOptions.refresh ?? false);
  if (commandOptions.json) {
    console.info(JSON.stringify(surveyResult, null, 2));
    return;
  }

  if (surveyResult.engines.length === 0) {
    console.info("No runtime survey results");
    return;
  }

  // Find and render the llama.cpp engine's survey
  const engineSurvey = surveyResult.engines.find(engine => engine.engine === "llama.cpp");
  if (engineSurvey !== undefined) {
    console.info(chalk.dim(`Survey by ${engineSurvey.name} (${engineSurvey.version})`));
    renderEngineSurvey(engineSurvey);
  } else {
    // If llama.cpp survey is not available, render the first engine's survey as a fallback
    const firstEngine = surveyResult.engines[0];
    console.info(chalk.dim(`Survey by ${firstEngine.name} (${firstEngine.version})`));
    renderEngineSurvey(firstEngine);
  }
});

export const survey = surveyCommand;
