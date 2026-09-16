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
  private lastHardwareSurveyTime = 0;
  private nextRecordId = 1;
  private currentLogFilePath: string | null = null;
  private lastLogReadOffset = 0;
  private readonly promptCandidates = new Map<
    string,
    { timeMs: number; tokens: number; timestamp: number }
  >();
  private readonly evalCandidates = new Map<
    string,
    { timeMs: number; tokens: number; tokPerSec: number; timestamp: number; model: string }
  >();
  private currentLogTimestamp = Date.now();
  private activeLogModel: string = "LLM";
  private knownModelMap: Array<{
    key: string;
    exactMatches: string[];
    keywords: string[];
  }> = [];
  private readonly instanceRefModelMap = new Map<string, string>();
  private streamActive: boolean = false;
  private readonly activeModelRequests = new Map<string, number>();
  private readonly activeLogTasks = new Map<string, { model: string; timestamp: number }>();

  private readonly isLocal: boolean;

  public constructor(
    private readonly client: LMStudioClient,
    private readonly logger: SimpleLogger,
    private readonly host: string,
    private readonly port: number,
    isLocal?: boolean,
  ) {
    this.isLocal = isLocal ?? this.isLocalHostRaw();
    if (this.isLocal) {
      this.initLogReader();
    }
  }

  private isLocalHostRaw(): boolean {
    const h = this.host.toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "0.0.0.0" || h === "::";
  }

  public isLocalHost(): boolean {
    return this.isLocal;
  }

  public updateKnownModels(
    downloadedModels: Array<{ modelKey: string; path?: string }>,
    loadedModels: LoadedModelItem[],
  ): void {
    const map: Array<{
      key: string;
      exactMatches: string[];
      keywords: string[];
    }> = [];

    for (const lm of loadedModels) {
      const exactMatches = [lm.identifier.toLowerCase(), lm.modelKey.toLowerCase()];
      const parts = lm.modelKey.toLowerCase().split(/[/_.-]/).filter(p => p.length > 2);
      map.push({ key: lm.identifier, exactMatches, keywords: [...new Set(parts)] });
    }

    for (const dm of downloadedModels) {
      const exactMatches = [dm.modelKey.toLowerCase()];
      if (dm.path) {
        const normPath = dm.path.replace(/\\/g, "/").toLowerCase();
        exactMatches.push(normPath);
        exactMatches.push(path.basename(normPath).toLowerCase());
      }
      const parts = dm.modelKey.toLowerCase().split(/[/_.-]/).filter(p => p.length > 2);
      map.push({ key: dm.modelKey, exactMatches, keywords: [...new Set(parts)] });
    }

    this.knownModelMap = map;
  }

  public resolveModelName(filePath: string, defaultName: string = "LLM"): string {
    const norm = filePath.replace(/\\/g, "/");
    const lower = norm.toLowerCase();
    const base = path.basename(norm, path.extname(norm)).toLowerCase();

    // 1. First priority: Exact match on full identifier, modelKey, or path/basename
    for (const item of this.knownModelMap) {
      for (const exact of item.exactMatches) {
        if (lower === exact || base === exact) {
          return item.key;
        }
      }
    }

    // 2. Second priority: Full identifier or modelKey contained in path (longer/more specific keys first)
    const sortedByLength = [...this.knownModelMap].sort((a, b) => b.key.length - a.key.length);
    for (const item of sortedByLength) {
      for (const exact of item.exactMatches) {
        if (exact.length >= 4 && lower.includes(exact)) {
          return item.key;
        }
      }
    }

    // 3. Third priority: Specific keywords, excluding generic vendor tokens that cause collisions
    for (const item of sortedByLength) {
      const specificKeywords = item.keywords.filter(
        kw => kw !== "google" && kw !== "meta" && kw !== "microsoft" && kw !== "ai" && kw.length >= 3,
      );
      if (specificKeywords.some(kw => lower.includes(kw))) {
        return item.key;
      }
    }

    // 4. Fallback heuristics for popular model families
    if (lower.includes("deepseek")) return "deepseek-r1-distill-qwen-7b";
    if (lower.includes("gemma")) return "google/gemma-4-12b-qat";
    if (lower.includes("qwen")) return "qwen";
    if (lower.includes("llama")) return "llama";

    const baseName = path.basename(norm, path.extname(norm));
    if (baseName && baseName.toLowerCase() !== "model") {
      let resolved = baseName.toLowerCase();
      if (resolved.startsWith("google_")) {
        resolved = "google/" + resolved.substring(7).replace(/_/g, "-");
      }
      return resolved;
    }
    const parentDir = path.basename(path.dirname(norm));
    if (parentDir && parentDir.toLowerCase() !== "models" && parentDir !== "" && parentDir !== ".") {
      const grandParent = path.basename(path.dirname(path.dirname(norm)));
      if (
        grandParent &&
        (grandParent.toLowerCase() === "google" ||
          grandParent.toLowerCase() === "meta" ||
          grandParent.toLowerCase() === "lmstudio")
      ) {
        return `${grandParent.toLowerCase()}/${parentDir.toLowerCase()}`;
      }
      return parentDir.toLowerCase();
    }

    return baseName || defaultName;
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

      const lastNewlineIndex = buffer.lastIndexOf(0x0a);
      if (lastNewlineIndex === -1) {
        this.lastLogReadOffset = stat.size;
        return;
      }

      this.lastLogReadOffset = startOffset + lastNewlineIndex + 1;
      const completeLinesBuffer = buffer.subarray(0, lastNewlineIndex + 1);
      const textContent = new TextDecoder().decode(completeLinesBuffer);
      // Pass isInitialBackfill = true so initial history is populated without counting historical tokens as session generated
      this.parseLogChunk(textContent, "LLM", true);
      this.activeLogTasks.clear();
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

      const lastNewlineIndex = buffer.lastIndexOf(0x0a);
      if (lastNewlineIndex === -1) {
        // Line is incomplete (e.g. logger is currently writing), wait for next poll
        return;
      }

      this.lastLogReadOffset += lastNewlineIndex + 1;
      const completeLinesBuffer = buffer.subarray(0, lastNewlineIndex + 1);
      const textContent = new TextDecoder().decode(completeLinesBuffer);
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

      // Ignore administrative and descriptor queries (e.g. getModelInfo / getLoadConfig polling queries from lms top)
      const isDescriptorLookup =
        /Endpoint=(?:getModelInfo|getLoadConfig|getInstanceProcessingState|listLoaded|listDownloadedModels|surveyHardware)|Getting descriptor for specifier/i.test(line);

      // Only attribute instance references or models that appear in request/inference contexts
      const isRequestContext =
        /Endpoint=(?:predict|predictCompletion|chat|createChatCompletion|completions)|(?:POST|GET)\s+(?:\/api\/v1\/(?:chat|responses)|\/v1\/(?:chat\/)?completions)|slot launch_slot_/i.test(line);

      if (!isDescriptorLookup && isRequestContext) {
        const instRefMatch = instRefRegex.exec(line);
        if (instRefMatch !== null) {
          const mapped = this.instanceRefModelMap.get(instRefMatch[1]);
          if (mapped !== undefined) {
            this.activeLogModel = mapped;
          }
        }
        const modelParamMatch = /"(?:model|modelIdentifier)":\s*"([^"]+)"/i.exec(line);
        if (modelParamMatch !== null) {
          this.activeLogModel = this.resolveModelName(modelParamMatch[1], defaultModelIdentifier);
        }
      }

      const loadMatch = loadModelRegex.exec(line);
      if (loadMatch !== null) {
        this.activeLogModel = this.resolveModelName(loadMatch[1], defaultModelIdentifier);
      }

      const slotMatch = /(?:slot\s*(\d+)|slot_id\s*=\s*(\d+)|task\s*(\d+))/i.exec(line);
      const slotKey = slotMatch ? slotMatch[1] || slotMatch[2] || slotMatch[3] : "default";

      const promptMatch = promptRegex.exec(line);
      if (promptMatch !== null) {
        this.promptCandidates.set(slotKey, {
          timeMs: parseFloat(promptMatch[1]),
          tokens: parseInt(promptMatch[2], 10),
          timestamp: this.currentLogTimestamp,
        });
      }

      // Track active tasks from engine logs (launching vs releasing)
      const isLaunch = /slot\s+launch_slot_:|processing\s+task/i.test(line);
      if (isLaunch) {
        const taskMatch = /task\s+(\d+)/i.exec(line);
        const taskId = taskMatch ? taskMatch[1] : `task_${Date.now()}`;
        const recordModel =
          this.activeLogModel !== "LLM"
            ? this.activeLogModel
            : defaultModelIdentifier;
        if (!isInitialBackfill) {
          this.activeLogTasks.set(taskId, { model: recordModel, timestamp: Date.now() });
        }
      }

      // Track intermediate generation speed if emitted during streaming (e.g. tg = 29.53 t/s)
      const tgMatch = /tg(?:_3s)?\s*=\s*([\d.]+)\s*t\/s/i.exec(line);
      if (tgMatch !== null && !isInitialBackfill) {
        const liveSpeed = parseFloat(tgMatch[1]);
        if (liveSpeed > 0) {
          this.tracker.currentTokensPerSec = liveSpeed;
        }
      }

      const isRelease = /slot\s+release:|stop\s+processing/i.test(line);
      if (isRelease) {
        const releaseTaskMatch = /task\s+(\d+)/i.exec(line);
        if (releaseTaskMatch) {
          this.activeLogTasks.delete(releaseTaskMatch[1]);
        } else {
          this.activeLogTasks.clear();
        }
      }

      const evalMatch = evalRegex.exec(line);
      if (evalMatch !== null) {
        this.evalCandidates.set(slotKey, {
          timeMs: parseFloat(evalMatch[1]),
          tokens: parseInt(evalMatch[2], 10),
          tokPerSec: evalMatch[3] ? parseFloat(evalMatch[3]) : 0,
          timestamp: this.currentLogTimestamp,
          model: this.activeLogModel !== "LLM" ? this.activeLogModel : defaultModelIdentifier,
        });
      }

      const totalMatch = totalRegex.exec(line);
      const evalCand =
        this.evalCandidates.get(slotKey) ?? this.evalCandidates.values().next().value;
      if (totalMatch !== null && evalCand !== undefined) {
        const promptCand =
          this.promptCandidates.get(slotKey) ?? this.promptCandidates.values().next().value;
        const promptTokens = promptCand?.tokens ?? 0;
        const predTokens = evalCand.tokens;
        const totalTimeSec = parseFloat(totalMatch[1]) / 1000;
        const totalTokens = parseInt(totalMatch[2], 10);
        const evalTokPerSec =
          evalCand.tokPerSec > 0
            ? evalCand.tokPerSec
            : predTokens / Math.max(0.001, evalCand.timeMs / 1000);
        const ttftSec = (promptCand?.timeMs ?? 0) / 1000;

        const recordModel = evalCand.model;

        const record: RecentPredictionRecord = {
          id: String(this.nextRecordId++),
          timestamp: evalCand.timestamp,
          modelIdentifier: recordModel,
          promptTokens,
          predictedTokens: predTokens,
          totalTokens: totalTokens,
          tokensPerSecond: evalTokPerSec,
          ttftSec: ttftSec,
          totalTimeSec: totalTimeSec,
          stopReason: "completed",
          source: "log",
          isBackfill: isInitialBackfill,
        };

        const totalTaskMatch = /task\s+(\d+)/i.exec(line);
        if (totalTaskMatch) {
          this.activeLogTasks.delete(totalTaskMatch[1]);
        } else {
          this.activeLogTasks.clear();
        }

        this.promptCandidates.delete(slotKey);
        this.evalCandidates.delete(slotKey);

        this.tracker.history.unshift(record);
        if (this.tracker.history.length > 20) {
          this.tracker.history.pop();
        }

        // Only update current speed, TTFT, and session totals for live inferences, not initial historical log backfill
        if (!isInitialBackfill) {
          if (evalTokPerSec > 0) {
            this.tracker.currentTokensPerSec = evalTokPerSec;
          }
          if (ttftSec > 0) {
            this.tracker.lastTtftSec = ttftSec;
          }
          this.tracker.totalTokensGenerated += predTokens;
          this.tracker.totalPromptTokens += promptTokens;
        }
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
          const current = this.activeModelRequests.get(log.data.modelIdentifier) ?? 0;
          this.activeModelRequests.set(log.data.modelIdentifier, current + 1);
        } else if (log.data.type === "llm.prediction.output") {
          this.tracker.activePredictions = Math.max(0, this.tracker.activePredictions - 1);
          const current = this.activeModelRequests.get(log.data.modelIdentifier) ?? 1;
          if (current <= 1) {
            this.activeModelRequests.delete(log.data.modelIdentifier);
          } else {
            this.activeModelRequests.set(log.data.modelIdentifier, current - 1);
          }
          const stats = log.data.stats;
          // Keep the log fallback active when stream stats are absent; only disable file fallback after receiving usable stats
          if (stats !== undefined) {
            this.streamActive = true;
            const tokPerSec = stats.tokensPerSecond ?? 0;
            const promptCount = stats.promptTokensCount ?? 0;
            const predCount = stats.predictedTokensCount ?? 0;
            const totalCount = stats.totalTokensCount ?? promptCount + predCount;
            const ttft = stats.timeToFirstTokenSec ?? 0;
            const totalTime = stats.totalTimeSec ?? 0;

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
    const liveRecords = this.tracker.history.filter(r => !r.isBackfill);
    const validToks = liveRecords
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

  private clearLiveActivity(): void {
    this.tracker.activePredictions = 0;
    this.tracker.currentTokensPerSec = 0;
    this.streamActive = false;
    this.activeModelRequests.clear();
    this.activeLogTasks.clear();
    this.promptCandidates.clear();
    this.evalCandidates.clear();
  }

  public async fetchSnapshot(): Promise<TopSnapshot> {
    const isRunning = await checkHttpServer(this.logger, this.port, this.host);

    if (!isRunning) {
      this.clearLiveActivity();
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

    // Hardware survey: refresh periodically (every 5000ms) or on first snapshot
    const now = Date.now();
    if (this.cachedHardware === null || now - this.lastHardwareSurveyTime >= 5000) {
      this.lastHardwareSurveyTime = now;
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
    // Ingest latest log lines to pick up any new requests or completions
    this.refreshLogs(this.activeLogModel !== "LLM" ? this.activeLogModel : "LLM");

    // Clean up stale log tasks older than 120s
    for (const [taskId, entry] of this.activeLogTasks.entries()) {
      if (now - entry.timestamp > 120_000) {
        this.activeLogTasks.delete(taskId);
      }
    }

    // Loaded models
    const loadedModels: LoadedModelItem[] = [];
    let totalBusy = 0;
    const hasGpu = (this.cachedHardware?.gpus.length ?? 0) > 0;

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

          const rawStatus = (processingState.status || "idle").toLowerCase();
          const isRpcBusy =
            (rawStatus !== "idle" && rawStatus !== "") || (processingState.queued ?? 0) > 0;

          const streamCount = this.activeModelRequests.get(model.identifier) ?? 0;
          const streamRunning =
            streamCount > 0 ||
            Array.from(this.activeModelRequests.entries()).some(
              ([id, count]) =>
                count > 0 &&
                (id.toLowerCase() === model.identifier.toLowerCase() ||
                  id.toLowerCase() === info.modelKey.toLowerCase() ||
                  model.identifier.toLowerCase().includes(id.toLowerCase()) ||
                  id.toLowerCase().includes(model.identifier.toLowerCase())),
            );

          const logTasksCount = Array.from(this.activeLogTasks.values()).filter(
            t =>
              t.model.toLowerCase() === model.identifier.toLowerCase() ||
              t.model.toLowerCase() === info.modelKey.toLowerCase() ||
              model.identifier.toLowerCase().includes(t.model.toLowerCase()) ||
              t.model.toLowerCase().includes(model.identifier.toLowerCase()),
          ).length;

          const isBusy = isRpcBusy || streamRunning || logTasksCount > 0;
          if (isBusy) {
            const rpcCount = isRpcBusy ? Math.max(1, processingState.queued ?? 0) : 0;
            const busyCount = Math.max(1, rpcCount, streamCount, logTasksCount);
            totalBusy += busyCount;
          }

          const instanceRef = (info as any)?.instanceReference ?? (model as any)?.instanceReference;
          if (instanceRef) {
            this.instanceRefModelMap.set(String(instanceRef), model.identifier);
          }

          // Calculate real-time estimated VRAM and RAM footprint
          let gpuRatio = hasGpu ? 1.0 : 0.0;
          if (loadConfig?.gpu?.ratio !== undefined) {
            if (loadConfig.gpu.ratio === "off") {
              gpuRatio = 0.0;
            } else if (loadConfig.gpu.ratio === "max") {
              gpuRatio = 1.0;
            } else if (typeof loadConfig.gpu.ratio === "number") {
              gpuRatio = Math.max(0, Math.min(1, loadConfig.gpu.ratio));
            }
          }

          const modelSizeBytes = info.sizeBytes || 0;
          const weightsVram = Math.round(modelSizeBytes * gpuRatio);
          const weightsRam = Math.round(modelSizeBytes * (1.0 - gpuRatio));

          // Context KV cache: ~128KB per token
          const effectiveCtx = Math.max(512, contextLength);
          const kvCacheBytes = Math.round(effectiveCtx * 128_000);
          const kvOnGpu = loadConfig?.offloadKVCacheToGpu !== false && gpuRatio > 0;
          const kvVram = kvOnGpu ? kvCacheBytes : 0;
          const kvRam = kvOnGpu ? 0 : kvCacheBytes;

          // Dynamic in-flight buffer while actively streaming
          const activeCount = Math.max(
            1,
            (isRpcBusy ? processingState.queued || 1 : 0) + logTasksCount + streamCount,
          );
          const liveBuffer = isBusy ? activeCount * 256 * 1024 * 1024 : 0;
          const liveVram = gpuRatio > 0 ? liveBuffer : 0;
          const liveRam = gpuRatio > 0 ? 0 : liveBuffer;

          const estimatedVramBytes = weightsVram + kvVram + liveVram;
          const estimatedRamBytes = weightsRam + kvRam + liveRam;

          loadedModels.push({
            identifier: model.identifier,
            modelKey: info.modelKey,
            type: "llm",
            architecture: info.architecture,
            paramsString: info.paramsString,
            format: info.format,
            sizeBytes: modelSizeBytes,
            estimatedVramBytes,
            estimatedRamBytes,
            contextLength,
            parallel: loadConfig?.maxParallelPredictions ?? "-",
            status: isBusy ? "RUNNING" : "IDLE",
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

          const rawStatus = (processingState.status || "idle").toLowerCase();
          const isRpcBusy =
            (rawStatus !== "idle" && rawStatus !== "") || (processingState.queued ?? 0) > 0;
          const streamCount = this.activeModelRequests.get(model.identifier) ?? 0;
          const streamRunning =
            streamCount > 0 ||
            Array.from(this.activeModelRequests.entries()).some(
              ([id, count]) =>
                count > 0 &&
                (id.toLowerCase() === model.identifier.toLowerCase() ||
                  id.toLowerCase() === info.modelKey.toLowerCase() ||
                  model.identifier.toLowerCase().includes(id.toLowerCase()) ||
                  id.toLowerCase().includes(model.identifier.toLowerCase())),
            );
          const isBusy = isRpcBusy || streamRunning;
          if (isBusy) {
            totalBusy += Math.max(1, (isRpcBusy ? processingState.queued || 1 : 0) + streamCount);
          }

          const modelSizeBytes = info.sizeBytes || 0;
          const isCpuDevice = info.deviceIdentifier?.toLowerCase().includes("cpu") ?? !hasGpu;
          const estimatedVramBytes = isCpuDevice ? 0 : modelSizeBytes;
          const estimatedRamBytes = isCpuDevice ? modelSizeBytes : 0;

          loadedModels.push({
            identifier: model.identifier,
            modelKey: info.modelKey,
            type: "embedding",
            architecture: info.architecture,
            paramsString: info.paramsString,
            format: info.format,
            sizeBytes: modelSizeBytes,
            estimatedVramBytes,
            estimatedRamBytes,
            contextLength,
            parallel: "-",
            status: isBusy ? "RUNNING" : "IDLE",
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
    // When multiple models are loaded, attribute to whichever model is actively RUNNING or PROCESSING
    const runningModel = loadedModels.find(m => m.status === "RUNNING" || m.status === "PROCESSING");
    const activeModelIdentifier = runningModel ? runningModel.identifier : loadedModels[0]?.identifier ?? "LLM";
    this.refreshLogs(activeModelIdentifier);

    // Update active predictions preserving live stream counter if active, or sync to totalBusy
    if (this.streamActive) {
      this.tracker.activePredictions = Math.max(this.tracker.activePredictions, totalBusy);
    } else {
      this.tracker.activePredictions = totalBusy;
    }

    if (totalBusy === 0 && this.tracker.activePredictions === 0) {
      this.tracker.currentTokensPerSec = 0;
    }

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
