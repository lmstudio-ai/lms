import fs from "fs";
import path from "path";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { findLMStudioHome } from "@lmstudio/lms-common-server";
import { type LMStudioClient } from "@lmstudio/sdk";
import { checkHttpServer } from "../../createClient.js";
import {
  type GpuItem,
  type HardwareSummary,
  type LoadedModelItem,
  type RecentPredictionRecord,
  type ThroughputMetrics,
  type TopSnapshot,
} from "./types.js";

interface InternalThroughputTracker {
  activePredictions: number;
  currentTokensPerSec: number;
  totalTokensGenerated: number;
  totalPromptTokens: number;
  lastTtftSec: number | null;
  history: RecentPredictionRecord[];
}

export class TopDataCollector {
  private readonly tracker: InternalThroughputTracker = {
    activePredictions: 0,
    currentTokensPerSec: 0,
    totalTokensGenerated: 0,
    totalPromptTokens: 0,
    lastTtftSec: null,
    history: [],
  };
  private unsubscribeLogs: (() => void) | null = null;
  private cachedHardware: HardwareSummary | null = null;
  private nextRecordId = 1;
  private currentLogFilePath: string | null = null;
  private lastLogReadOffset = 0;
  private lastPromptCandidate: { timeMs: number; tokens: number; timestamp: number } | null = null;
  private lastEvalCandidate: { timeMs: number; tokens: number; tokPerSec: number; timestamp: number } | null = null;
  private currentLogTimestamp = Date.now();
  private activeLogModel: string = "LLM";
  private knownModelMap: Array<{ key: string; keywords: string[] }> = [];
  private readonly instanceRefModelMap = new Map<string, string>();
  private streamActive: boolean = false;
  private readonly processedCompletionKeys = new Set<string>();

  public constructor(
    private readonly client: LMStudioClient,
    private readonly logger: SimpleLogger,
    private readonly host: string,
    private readonly port: number,
  ) {
    if (this.isLocalHost()) {
      this.initLogReader();
    }
  }

  public isLocalHost(): boolean {
    const h = this.host.toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "0.0.0.0";
  }

  public updateKnownModels(
    downloadedModels: Array<{ modelKey: string; path?: string }>,
    loadedModels: LoadedModelItem[],
  ): void {
    const map: Array<{ key: string; keywords: string[] }> = [];

    for (const lm of loadedModels) {
      const kw = [lm.identifier.toLowerCase(), lm.modelKey.toLowerCase()];
      const parts = lm.modelKey.toLowerCase().split(/[/_.-]/).filter(p => p.length > 2);
      kw.push(...parts);
      map.push({ key: lm.identifier, keywords: [...new Set(kw)] });
    }

    for (const dm of downloadedModels) {
      const kw = [dm.modelKey.toLowerCase()];
      if (dm.path) {
        kw.push(dm.path.replace(/\\/g, "/").toLowerCase());
        kw.push(path.basename(dm.path).toLowerCase());
      }
      const parts = dm.modelKey.toLowerCase().split(/[/_.-]/).filter(p => p.length > 2);
      kw.push(...parts);
      map.push({ key: dm.modelKey, keywords: [...new Set(kw)] });
    }

    this.knownModelMap = map;
  }

  public resolveModelName(filePath: string, defaultName: string = "LLM"): string {
    const norm = filePath.replace(/\\/g, "/");
    const lower = norm.toLowerCase();

    for (const item of this.knownModelMap) {
      if (item.keywords.some(kw => lower.includes(kw))) {
        return item.key;
      }
    }

    // Heuristics for popular model families
    if (lower.includes("deepseek")) return "deepseek-r1-distill-qwen-7b";
    if (lower.includes("gemma")) return "google/gemma-4-12b-qat";
    if (lower.includes("qwen")) return "qwen";
    if (lower.includes("llama")) return "llama";

    const base = path.basename(norm, path.extname(norm));
    return base || defaultName;
  }

  private getLatestLogFilePath(): string | null {
    try {
      const serverLogsDir = path.join(findLMStudioHome(), "server-logs");
      if (!fs.existsSync(serverLogsDir)) return null;
      const monthDirs = fs
        .readdirSync(serverLogsDir)
        .filter(d => {
          try {
            return fs.statSync(path.join(serverLogsDir, d)).isDirectory();
          } catch {
            return false;
          }
        })
        .sort();
      if (monthDirs.length === 0) return null;
      const latestMonth = monthDirs[monthDirs.length - 1];
      const monthPath = path.join(serverLogsDir, latestMonth);
      const logFiles = fs
        .readdirSync(monthPath)
        .filter(f => f.endsWith(".log"))
        .sort();
      if (logFiles.length === 0) return null;
      return path.join(monthPath, logFiles[logFiles.length - 1]);
    } catch {
      return null;
    }
  }

  private initLogReader(): void {
    const logFile = this.getLatestLogFilePath();
    if (logFile === null) return;
    this.currentLogFilePath = logFile;

    try {
      const stat = fs.statSync(logFile);
      const initialReadSize = Math.min(stat.size, 5 * 1024 * 1024);
      const startOffset = stat.size - initialReadSize;

      const fd = fs.openSync(logFile, "r");
      const buffer = new Uint8Array(initialReadSize);
      fs.readSync(fd, buffer, 0, initialReadSize, startOffset);
      fs.closeSync(fd);

      this.lastLogReadOffset = stat.size;
      const textContent = new TextDecoder().decode(buffer);
      // Pass isInitialBackfill = true so initial history is populated without counting historical tokens as session generated
      this.parseLogChunk(textContent, "LLM", true);
    } catch (e) {
      this.logger.debug("Failed to read initial log lines", e);
    }
  }

  private refreshLogs(defaultModelIdentifier: string): void {
    if (!this.isLocalHost() || this.streamActive) {
      return;
    }

    const latestFile = this.getLatestLogFilePath();
    if (latestFile === null) return;

    if (latestFile !== this.currentLogFilePath) {
      this.currentLogFilePath = latestFile;
      this.lastLogReadOffset = 0;
    }

    try {
      const stat = fs.statSync(latestFile);
      if (stat.size <= this.lastLogReadOffset) {
        return;
      }

      const bytesToRead = stat.size - this.lastLogReadOffset;
      const fd = fs.openSync(latestFile, "r");
      const buffer = new Uint8Array(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, this.lastLogReadOffset);
      fs.closeSync(fd);

      this.lastLogReadOffset = stat.size;
      const textContent = new TextDecoder().decode(buffer);
      this.parseLogChunk(textContent, defaultModelIdentifier, false);
    } catch (e) {
      this.logger.debug("Failed refreshing server logs", e);
    }
  }

  public parseLogChunk(
    chunk: string,
    defaultModelIdentifier: string,
    isInitialBackfill: boolean = false,
  ): void {
    const lines = chunk.split("\n");
    const timeRegex = /\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]/;
    const loadModelRegex = /load_model:\s*loading model\s*['"]([^'"]+)['"]/i;
    const instRefRegex = /"instanceReference":\s*"([^"]+)"/i;
    const promptRegex =
      /prompt eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens/i;
    const evalRegex =
      /eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens(?:\s*\([^,]+,\s*([\d.]+)\s*tokens per second\))?/i;
    const totalRegex =
      /total time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens/i;

    for (const line of lines) {
      const timeMatch = timeRegex.exec(line);
      if (timeMatch !== null) {
        this.currentLogTimestamp = new Date(timeMatch[1].replace(" ", "T")).getTime();
      }

      const instRefMatch = instRefRegex.exec(line);
      if (instRefMatch !== null) {
        const mapped = this.instanceRefModelMap.get(instRefMatch[1]);
        if (mapped !== undefined) {
          this.activeLogModel = mapped;
        }
      }

      const loadMatch = loadModelRegex.exec(line);
      if (loadMatch !== null) {
        this.activeLogModel = this.resolveModelName(loadMatch[1], defaultModelIdentifier);
      }

      const promptMatch = promptRegex.exec(line);
      if (promptMatch !== null) {
        this.lastPromptCandidate = {
          timeMs: parseFloat(promptMatch[1]),
          tokens: parseInt(promptMatch[2], 10),
          timestamp: this.currentLogTimestamp,
        };
      }

      const evalMatch = evalRegex.exec(line);
      if (evalMatch !== null) {
        this.lastEvalCandidate = {
          timeMs: parseFloat(evalMatch[1]),
          tokens: parseInt(evalMatch[2], 10),
          tokPerSec: evalMatch[3] ? parseFloat(evalMatch[3]) : 0,
          timestamp: this.currentLogTimestamp,
        };
      }

      const totalMatch = totalRegex.exec(line);
      if (totalMatch !== null && this.lastEvalCandidate !== null) {
        const promptTokens = this.lastPromptCandidate?.tokens ?? 0;
        const predTokens = this.lastEvalCandidate.tokens;
        const totalTimeSec = parseFloat(totalMatch[1]) / 1000;
        const totalTokens = parseInt(totalMatch[2], 10);
        const evalTokPerSec =
          this.lastEvalCandidate.tokPerSec > 0
            ? this.lastEvalCandidate.tokPerSec
            : predTokens /
              Math.max(0.001, this.lastEvalCandidate.timeMs / 1000);
        const ttftSec = (this.lastPromptCandidate?.timeMs ?? 0) / 1000;

        // Cross-source deduplication: if this exact completion was already received via diagnostics stream within 5 seconds, skip it
        const isDuplicateFromStream = this.tracker.history.slice(0, 5).some(
          prev =>
            prev.source === "stream" &&
            prev.promptTokens === promptTokens &&
            prev.predictedTokens === predTokens &&
            Math.abs(prev.timestamp - this.lastEvalCandidate!.timestamp) <= 5000,
        );
        if (isDuplicateFromStream) {
          this.lastPromptCandidate = null;
          this.lastEvalCandidate = null;
          continue;
        }

        const recordModel =
          this.activeLogModel !== "LLM"
            ? this.activeLogModel
            : defaultModelIdentifier;

        const record: RecentPredictionRecord = {
          id: String(this.nextRecordId++),
          timestamp: this.lastEvalCandidate.timestamp,
          modelIdentifier: recordModel,
          promptTokens,
          predictedTokens: predTokens,
          totalTokens: totalTokens,
          tokensPerSecond: evalTokPerSec,
          ttftSec: ttftSec,
          totalTimeSec: totalTimeSec,
          stopReason: "completed",
          source: "log",
        };

        this.tracker.history.unshift(record);
        if (this.tracker.history.length > 20) {
          this.tracker.history.pop();
        }

        if (evalTokPerSec > 0) {
          this.tracker.currentTokensPerSec = evalTokPerSec;
        }
        if (ttftSec > 0) {
          this.tracker.lastTtftSec = ttftSec;
        }

        // Only increment session totals for live inferences, not initial historical log backfill
        if (!isInitialBackfill) {
          this.tracker.totalTokensGenerated += predTokens;
          this.tracker.totalPromptTokens += promptTokens;
        }

        this.lastPromptCandidate = null;
        this.lastEvalCandidate = null;
      }
    }
  }

  public startListening(): void {
    if (this.unsubscribeLogs !== null) {
      return;
    }
    try {
      this.unsubscribeLogs = this.client.diagnostics.unstable_streamLogs(log => {
        if (log.data.type === "llm.prediction.input") {
          this.tracker.activePredictions++;
        } else if (log.data.type === "llm.prediction.output") {
          this.streamActive = true;
          this.tracker.activePredictions = Math.max(0, this.tracker.activePredictions - 1);
          const stats = log.data.stats;
          if (stats !== undefined) {
            const tokPerSec = stats.tokensPerSecond ?? 0;
            const promptCount = stats.promptTokensCount ?? 0;
            const predCount = stats.predictedTokensCount ?? 0;
            const totalCount = stats.totalTokensCount ?? promptCount + predCount;
            const ttft = stats.timeToFirstTokenSec ?? 0;
            const totalTime = stats.totalTimeSec ?? 0;

            // Cross-source deduplication: if this exact completion was already received via log file within 5 seconds, skip it
            const isDuplicateFromLog = this.tracker.history.slice(0, 5).some(
              prev =>
                prev.source === "log" &&
                prev.promptTokens === promptCount &&
                prev.predictedTokens === predCount &&
                Math.abs(prev.timestamp - log.timestamp) <= 5000,
            );
            if (isDuplicateFromLog) {
              return;
            }

            if (tokPerSec > 0) {
              this.tracker.currentTokensPerSec = tokPerSec;
            }
            this.tracker.totalTokensGenerated += predCount;
            this.tracker.totalPromptTokens += promptCount;
            if (ttft > 0) {
              this.tracker.lastTtftSec = ttft;
            }

            const record: RecentPredictionRecord = {
              id: String(this.nextRecordId++),
              timestamp: log.timestamp,
              modelIdentifier: log.data.modelIdentifier,
              promptTokens: promptCount,
              predictedTokens: predCount,
              totalTokens: totalCount,
              tokensPerSecond: tokPerSec,
              ttftSec: ttft,
              totalTimeSec: totalTime,
              stopReason: stats.stopReason ?? "completed",
              source: "stream",
            };

            this.tracker.history.unshift(record);
            if (this.tracker.history.length > 20) {
              this.tracker.history.pop();
            }
          }
        }
      });
    } catch {
      // Ignored for clients without permission
    }
  }

  public stopListening(): void {
    if (this.unsubscribeLogs !== null) {
      try {
        this.unsubscribeLogs();
      } catch {
        // Ignore cleanup errors
      }
      this.unsubscribeLogs = null;
    }
  }

  public getThroughputMetrics(): ThroughputMetrics {
    const validToks = this.tracker.history
      .map(r => r.tokensPerSecond)
      .filter(v => v > 0);
    const avgToks =
      validToks.length > 0
        ? validToks.reduce((sum, v) => sum + v, 0) / validToks.length
        : this.tracker.currentTokensPerSec;

    return {
      activePredictions: this.tracker.activePredictions,
      currentTokensPerSec: this.tracker.currentTokensPerSec,
      avgTokensPerSec: avgToks,
      totalTokensGenerated: this.tracker.totalTokensGenerated,
      totalPromptTokens: this.tracker.totalPromptTokens,
      lastTtftSec: this.tracker.lastTtftSec,
      recentPredictions: [...this.tracker.history.slice(0, 5)],
    };
  }

  public async fetchSnapshot(): Promise<TopSnapshot> {
    const isRunning = await checkHttpServer(this.logger, this.port, this.host);

    if (!isRunning) {
      return {
        server: {
          status: "offline",
          host: this.host,
          port: this.port,
          pid: null,
          isDaemon: null,
          version: null,
          build: null,
        },
        hardware: this.cachedHardware,
        loadedModels: [],
        throughput: this.getThroughputMetrics(),
        timestamp: Date.now(),
      };
    }

    // Server is online, query details
    let pid: number | null = null;
    let isDaemon: boolean | null = null;
    let version: string | null = null;
    let build: number | null = null;

    try {
      const [serviceInfo, versionInfo] = await Promise.all([
        this.client.system.getInfo().catch(() => null),
        this.client.system.getLMStudioVersion().catch(() => null),
      ]);
      if (serviceInfo !== null) {
        pid = serviceInfo.pid;
        isDaemon = serviceInfo.isDaemon;
      }
      if (versionInfo !== null) {
        version = versionInfo.version;
        build = versionInfo.build;
      }
    } catch (e) {
      this.logger.debug("Failed to query service info", e);
    }

    // Hardware survey (cache to avoid heavy repeated calls every tick)
    if (this.cachedHardware === null) {
      try {
        const survey = await this.client.runtime.surveyHardware();
        if (survey.engines.length > 0) {
          const primaryEngine = survey.engines[0];
          const gpus: GpuItem[] =
            primaryEngine.hardwareSurvey.gpuSurveyResult.gpuInfo.map(gpu => ({
              name: gpu.name,
              detectionPlatform: gpu.detectionPlatform,
              integrationType: gpu.integrationType,
              dedicatedMemoryBytes: gpu.dedicatedMemoryCapacityBytes,
              totalMemoryBytes: gpu.totalMemoryCapacityBytes,
            }));

          const cpuInfo = primaryEngine.hardwareSurvey.cpuSurveyResult.cpuInfo;
          this.cachedHardware = {
            gpus,
            ramCapacityBytes: primaryEngine.memoryInfo.ramCapacity,
            vramCapacityBytes: primaryEngine.memoryInfo.vramCapacity,
            cpuArchitecture: cpuInfo?.architecture ?? "unknown",
            cpuExtensions: cpuInfo?.supportedInstructionSetExtensions ?? [],
          };
        }
      } catch (e) {
        this.logger.debug("Hardware survey failed", e);
      }
    }

    // Loaded models
    const loadedModels: LoadedModelItem[] = [];
    let totalBusy = 0;

    try {
      const [llmModels, embeddingModels] = await Promise.all([
        this.client.llm.listLoaded().catch(() => []),
        this.client.embedding.listLoaded().catch(() => []),
      ]);

      for (const model of llmModels) {
        try {
          const [info, loadConfig, processingState, contextLength] = await Promise.all([
            model.getModelInfo(),
            model.getLoadConfig().catch(() => ({} as any)),
            model.getInstanceProcessingState().catch(() => ({ status: "idle", queued: 0 })),
            model.getContextLength().catch(() => 0),
          ]);

          const isBusy = processingState.status?.toLowerCase() === "processing";
          if (isBusy) {
            totalBusy += 1 + (processingState.queued || 0);
          }

          const instanceRef = (info as any)?.instanceReference ?? (model as any)?.instanceReference;
          if (instanceRef) {
            this.instanceRefModelMap.set(String(instanceRef), model.identifier);
          }

          loadedModels.push({
            identifier: model.identifier,
            modelKey: info.modelKey,
            type: "llm",
            architecture: info.architecture,
            paramsString: info.paramsString,
            format: info.format,
            sizeBytes: info.sizeBytes,
            contextLength,
            parallel: loadConfig?.maxParallelPredictions ?? "-",
            status: processingState.status?.toUpperCase() ?? "IDLE",
            queued: processingState.queued ?? 0,
            ttlMs: info.ttlMs,
            lastUsedTime: info.lastUsedTime,
            deviceIdentifier: info.deviceIdentifier,
          });
        } catch (e) {
          this.logger.debug(`Failed reading model details for ${model.identifier}`, e);
        }
      }

      for (const model of embeddingModels) {
        try {
          const [info, processingState, contextLength] = await Promise.all([
            model.getModelInfo(),
            model.getInstanceProcessingState().catch(() => ({ status: "idle", queued: 0 })),
            model.getContextLength().catch(() => 0),
          ]);

          const isBusy = processingState.status?.toLowerCase() === "processing";
          if (isBusy) {
            totalBusy += 1 + (processingState.queued || 0);
          }

          loadedModels.push({
            identifier: model.identifier,
            modelKey: info.modelKey,
            type: "embedding",
            architecture: info.architecture,
            paramsString: info.paramsString,
            format: info.format,
            sizeBytes: info.sizeBytes,
            contextLength,
            parallel: "-",
            status: processingState.status?.toUpperCase() ?? "IDLE",
            queued: processingState.queued ?? 0,
            ttlMs: info.ttlMs,
            lastUsedTime: info.lastUsedTime,
            deviceIdentifier: info.deviceIdentifier,
          });
        } catch (e) {
          this.logger.debug(`Failed reading embedding details for ${model.identifier}`, e);
        }
      }
    } catch (e) {
      this.logger.debug("Failed listing loaded models", e);
    }

    // Update known models mapping from downloaded models & loaded models
    try {
      const downloaded = await this.client.system.listDownloadedModels().catch(() => []);
      this.updateKnownModels(downloaded, loadedModels);
    } catch {
      // Ignore
    }

    // Refresh server logs to detect completions and update throughput stats
    // When multiple models are loaded, attribute to whichever model is actively PROCESSING
    const processingModel = loadedModels.find(m => m.status === "PROCESSING");
    const activeModelIdentifier = processingModel ? processingModel.identifier : loadedModels[0]?.identifier ?? "LLM";
    this.refreshLogs(activeModelIdentifier);

    // Update active predictions based on loaded model processing state
    this.tracker.activePredictions = totalBusy;

    return {
      server: {
        status: "online",
        host: this.host,
        port: this.port,
        pid,
        isDaemon,
        version,
        build,
      },
      hardware: this.cachedHardware,
      loadedModels,
      throughput: this.getThroughputMetrics(),
      timestamp: Date.now(),
    };
  }
}
