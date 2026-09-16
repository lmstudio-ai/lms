export interface ServerStatusInfo {
  status: "online" | "offline";
  host: string;
  port: number;
  pid: number | null;
  isDaemon: boolean | null;
  version: string | null;
  build: number | null;
}

export interface GpuItem {
  name: string;
  detectionPlatform: string;
  integrationType: string;
  dedicatedMemoryBytes: number;
  totalMemoryBytes: number;
}

export interface HardwareSummary {
  gpus: GpuItem[];
  ramCapacityBytes: number;
  vramCapacityBytes: number;
  cpuArchitecture: string;
  cpuExtensions: string[];
}

export interface LoadedModelItem {
  identifier: string;
  modelKey: string;
  type: "llm" | "embedding";
  architecture?: string;
  paramsString?: string;
  format?: string;
  sizeBytes: number;
  contextLength: number;
  parallel: number | "-";
  status: "IDLE" | "PROCESSING" | string;
  queued: number;
  ttlMs?: number | null;
  lastUsedTime?: number | null;
  deviceIdentifier?: string | null;
}

export interface RecentPredictionRecord {
  id: string;
  timestamp: number;
  modelIdentifier: string;
  promptTokens: number;
  predictedTokens: number;
  totalTokens: number;
  tokensPerSecond: number;
  ttftSec: number;
  totalTimeSec: number;
  stopReason: string;
}

export interface ThroughputMetrics {
  activePredictions: number;
  currentTokensPerSec: number;
  avgTokensPerSec: number;
  totalTokensGenerated: number;
  totalPromptTokens: number;
  lastTtftSec: number | null;
  recentPredictions: RecentPredictionRecord[];
}

export interface TopSnapshot {
  server: ServerStatusInfo;
  hardware: HardwareSummary | null;
  loadedModels: LoadedModelItem[];
  throughput: ThroughputMetrics;
  timestamp: number;
}
