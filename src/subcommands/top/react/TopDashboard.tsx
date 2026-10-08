import { Box, Text, useApp, useInput } from "ink";
import React, { useCallback, useEffect, useRef, useState } from "react";
import chalk from "chalk";
import { formatSizeBytes1000, formatSizeBytes1024 } from "../../../formatBytes.js";
import { formatTimeLean } from "../../../formatElapsedTime.js";
import { type TopDataCollector } from "../dataFetcher.js";
import { renderProgressBar } from "../renderProgressBar.js";
import { type LoadedModelItem, type TopSnapshot } from "../types.js";

export { renderProgressBar };

interface TopDashboardProps {
  collector: TopDataCollector;
  initialSnapshot: TopSnapshot;
  intervalMs: number;
}

export const TopDashboard: React.FC<TopDashboardProps> = ({
  collector,
  initialSnapshot,
  intervalMs,
}) => {
  const { exit } = useApp();
  const [snapshot, setSnapshot] = useState<TopSnapshot>(initialSnapshot);
  const [refreshCount, setRefreshCount] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date(initialSnapshot.timestamp));
  const isRefreshingRef = useRef(false);

  const performRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    try {
      const nextSnapshot = await collector.fetchSnapshot();
      setSnapshot(nextSnapshot);
      setLastRefreshedAt(new Date(nextSnapshot.timestamp));
      setRefreshCount(c => c + 1);
    } catch {
      // Ignore transient fetch errors during live polling
    } finally {
      isRefreshingRef.current = false;
    }
  }, [collector]);

  useEffect(() => {
    collector.startListening();
    const timer = setInterval(() => {
      void performRefresh();
    }, intervalMs);

    return () => {
      clearInterval(timer);
      collector.stopListening();
    };
  }, [collector, intervalMs, performRefresh]);

  useInput((input, key) => {
    if (input === "q" || key.escape || (key.ctrl && input === "c")) {
      collector.stopListening();
      exit();
    } else if (input === "r") {
      void performRefresh();
    }
  });

  const { server, hardware, loadedModels, throughput } = snapshot;
  const isOnline = server.status === "online";

  // Calculate estimated loaded models memory footprint (real-time VRAM and RAM)
  const totalModelsSizeBytes = loadedModels.reduce((acc, m) => acc + (m.sizeBytes || 0), 0);
  const totalVramUsedBytes = loadedModels.reduce(
    (acc, m) => acc + (m.estimatedVramBytes !== undefined ? m.estimatedVramBytes : (m.sizeBytes || 0)),
    0,
  );
  const totalRamUsedBytes = loadedModels.reduce(
    (acc, m) => acc + (m.estimatedRamBytes ?? 0),
    0,
  );
  const vramCapacity = hardware?.vramCapacityBytes ?? 0;
  const ramCapacity = hardware?.ramCapacityBytes ?? 0;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Header Banner */}
      <Box
        borderStyle="round"
        borderColor="#34D399"
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Box flexDirection="row" gap={1}>
          <Text bold color="#22D3EE">
            LM STUDIO TOP
          </Text>
          <Text dimColor>|</Text>
          {isOnline ? (
            <Text bold color="green">
              ● SERVER ONLINE
            </Text>
          ) : (
            <Text bold color="red">
              ○ SERVER OFFLINE
            </Text>
          )}
          <Text dimColor>
            (http://{server.host}:{server.port})
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {server.pid !== null && (
            <Text dimColor>PID: {chalk.white(server.pid)}</Text>
          )}
          {server.version !== null && (
            <Text dimColor>v{chalk.white(server.version)}</Text>
          )}
          <Text dimColor>• {lastRefreshedAt.toLocaleTimeString()}</Text>
        </Box>
      </Box>

      {/* Offline Warning Banner if Server not connected */}
      {!isOnline && (
        <Box
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
          marginY={1}
          flexDirection="column"
        >
          <Text color="yellow" bold>
            ⚠️ Server is currently unreachable at http://{server.host}:{server.port}
          </Text>
          <Text dimColor>
            Start the server in another terminal via: {chalk.cyan("lms server start")} or launch the LM Studio application.
          </Text>
          <Text dimColor>Reconnecting automatically in the background...</Text>
        </Box>
      )}

      {/* Hardware & Memory Metrics */}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginY={0}
        flexDirection="column"
      >
        <Text bold color="#818CF8">
          HARDWARE & MEMORY FOOTPRINT
        </Text>
        {hardware !== null && hardware.gpus.length > 0 && (
          <Box flexDirection="column" marginY={0}>
            {hardware.gpus.map((gpu, idx) => {
              const mem = gpu.dedicatedMemoryBytes > 0 ? gpu.dedicatedMemoryBytes : gpu.totalMemoryBytes;
              return (
                <Box key={idx} flexDirection="row" justifyContent="space-between">
                  <Text>
                    {chalk.bold(gpu.name)}{" "}
                    {chalk.dim(`(${gpu.detectionPlatform}, ${gpu.integrationType})`)}
                  </Text>
                  <Text dimColor>VRAM: {formatSizeBytes1024(mem)}</Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Real-time VRAM & RAM Footprint */}
        {(() => {
          const totalVram =
            vramCapacity > 0
              ? vramCapacity
              : hardware?.gpus.reduce(
                  (sum, g) => sum + (g.dedicatedMemoryBytes > 0 ? g.dedicatedMemoryBytes : g.totalMemoryBytes),
                  0,
                ) ?? 0;

          if (totalVram > 0) {
            const ratio = totalVramUsedBytes / totalVram;
            const hasRamUsage = totalRamUsedBytes > 0;
            return (
              <Box flexDirection="column" marginY={0}>
                <Box flexDirection="row" justifyContent="space-between">
                  <Text dimColor>VRAM Footprint (Est.):</Text>
                  <Text>
                    {formatSizeBytes1024(totalVramUsedBytes)} / {formatSizeBytes1024(totalVram)} Total VRAM
                    {hasRamUsage ? chalk.yellow(` (+${formatSizeBytes1024(totalRamUsedBytes)} RAM)`) : ""}
                  </Text>
                </Box>
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>Footprint:   </Text>
                  <Text>{renderProgressBar(ratio)}</Text>
                </Box>
              </Box>
            );
          } else {
            const ratio = ramCapacity > 0 ? totalRamUsedBytes / ramCapacity : 0;
            return (
              <Box flexDirection="column" marginY={0}>
                <Box flexDirection="row" justifyContent="space-between">
                  <Text dimColor>RAM Footprint (Est.):</Text>
                  <Text>
                    {formatSizeBytes1024(totalRamUsedBytes)} / {formatSizeBytes1024(ramCapacity)} System RAM
                  </Text>
                </Box>
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>Footprint:   </Text>
                  <Text>{renderProgressBar(ratio)}</Text>
                </Box>
              </Box>
            );
          }
        })()}

        {/* System RAM & CPU */}
        <Box flexDirection="row" justifyContent="space-between" marginTop={0}>
          <Text dimColor>
            RAM: {ramCapacity > 0 ? formatSizeBytes1024(ramCapacity) : "N/A"}
          </Text>
          <Text dimColor>
            CPU: {hardware?.cpuArchitecture ?? "unknown"}{" "}
            {hardware?.cpuExtensions && hardware.cpuExtensions.length > 0
              ? `(${hardware.cpuExtensions.slice(0, 4).join(", ")})`
              : ""}
          </Text>
        </Box>
      </Box>

      {/* Real-time Throughput & Inferences */}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginY={0}
        flexDirection="column"
      >
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="#34D399">
            INFERENCE & THROUGHPUT
          </Text>
          {throughput.activePredictions > 0 && (
            <Text color="yellow" bold>
              ⚡ {throughput.activePredictions} IN-FLIGHT REQUEST{throughput.activePredictions > 1 ? "S" : ""}
            </Text>
          )}
        </Box>

        <Box flexDirection="row" justifyContent="space-around" marginY={1}>
          <Box flexDirection="column" alignItems="center">
            <Text dimColor>CURRENT SPEED</Text>
            <Text bold color="#22D3EE">
              {throughput.currentTokensPerSec > 0
                ? `${throughput.currentTokensPerSec.toFixed(1)} tok/s`
                : "—"}
            </Text>
          </Box>
          <Box flexDirection="column" alignItems="center">
            <Text dimColor>AVERAGE SPEED</Text>
            <Text bold color="cyan">
              {throughput.avgTokensPerSec > 0
                ? `${throughput.avgTokensPerSec.toFixed(1)} tok/s`
                : "—"}
            </Text>
          </Box>
          <Box flexDirection="column" alignItems="center">
            <Text dimColor>TIME TO FIRST TOKEN</Text>
            <Text bold color="magenta">
              {throughput.lastTtftSec !== null
                ? `${(throughput.lastTtftSec * 1000).toFixed(0)} ms`
                : "—"}
            </Text>
          </Box>
          <Box flexDirection="column" alignItems="center">
            <Text dimColor>SESSION GENERATED</Text>
            <Text bold color="green">
              {throughput.totalTokensGenerated.toLocaleString()} tokens
            </Text>
          </Box>
        </Box>

        {/* Recent Inferences list */}
        {throughput.recentPredictions.length > 0 && (
          <Box flexDirection="column" marginTop={0}>
            <Text dimColor bold>
              Recent Completions:
            </Text>
            {throughput.recentPredictions.map(req => {
              const dateStr = new Date(req.timestamp).toLocaleTimeString();
              return (
                <Box key={req.id} flexDirection="row" justifyContent="space-between">
                  <Text dimColor>[{dateStr}]</Text>
                  <Text color="white">{req.modelIdentifier}</Text>
                  <Text color="cyan">{req.predictedTokens} toks</Text>
                  <Text color="green">{req.tokensPerSecond.toFixed(1)} tok/s</Text>
                  <Text color="yellow">{(req.ttftSec * 1000).toFixed(0)}ms TTFT</Text>
                  <Text dimColor>({req.stopReason})</Text>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Loaded Models Table */}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginY={0}
        flexDirection="column"
      >
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="#F9A8D4">
            LOADED MODELS ({loadedModels.length})
          </Text>
          <Text dimColor>
            {totalVramUsedBytes > 0 ? `VRAM: ${formatSizeBytes1024(totalVramUsedBytes)} | ` : ""}Weight: {formatSizeBytes1000(totalModelsSizeBytes)}
          </Text>
        </Box>

        {loadedModels.length === 0 ? (
          <Box marginY={1}>
            <Text dimColor>
              No models currently resident in memory. Run{" "}
              {chalk.cyan("lms load <model>")} to load a model.
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Box width="26%">
                <Text bold dimColor>
                  IDENTIFIER
                </Text>
              </Box>
              <Box width="15%">
                <Text bold dimColor>
                  STATUS
                </Text>
              </Box>
              <Box width="17%">
                <Text bold dimColor>
                  VRAM (EST)
                </Text>
              </Box>
              <Box width="18%">
                <Text bold dimColor>
                  CONTEXT
                </Text>
              </Box>
              <Box width="12%">
                <Text bold dimColor>
                  PARALLEL
                </Text>
              </Box>
              <Box width="12%">
                <Text bold dimColor>
                  TTL
                </Text>
              </Box>
            </Box>

            {loadedModels.map(model => {
              const isRunning = model.status === "RUNNING" || model.status === "PROCESSING";
              const statusColor = isRunning ? "yellow" : "green";
              const statusText = isRunning
                ? `⚡ RUNNING${model.queued > 0 ? ` (${model.queued}q)` : ""}`
                : "● IDLE";

              const timeLeft =
                model.ttlMs !== undefined && model.ttlMs !== null
                  ? model.lastUsedTime === null || model.lastUsedTime === undefined
                    ? model.ttlMs
                    : model.ttlMs - (Date.now() - model.lastUsedTime)
                  : null;

              const ttlText =
                timeLeft !== null && timeLeft > 0
                  ? formatTimeLean(timeLeft)
                  : model.ttlMs === null || model.ttlMs === undefined
                  ? "∞"
                  : "expiring";

              return (
                <Box key={model.identifier} flexDirection="row" justifyContent="space-between">
                  <Box width="26%">
                    <Text bold color="white" wrap="truncate">
                      {model.identifier}
                    </Text>
                  </Box>
                  <Box width="15%">
                    <Text color={statusColor}>{statusText}</Text>
                  </Box>
                  <Box width="17%">
                    <Text>
                      {model.estimatedVramBytes !== undefined && model.estimatedVramBytes > 0
                        ? formatSizeBytes1024(model.estimatedVramBytes)
                        : model.estimatedRamBytes !== undefined && model.estimatedRamBytes > 0
                        ? `${formatSizeBytes1024(model.estimatedRamBytes)} (RAM)`
                        : formatSizeBytes1000(model.sizeBytes)}
                    </Text>
                  </Box>
                  <Box width="18%">
                    <Text>{model.contextLength ? `${model.contextLength.toLocaleString()} ctx` : "-"}</Text>
                  </Box>
                  <Box width="12%">
                    <Text>{model.parallel}</Text>
                  </Box>
                  <Box width="12%">
                    <Text dimColor>{ttlText}</Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Footer Controls */}
      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Box flexDirection="row" gap={2}>
          <Text dimColor>
            <Text bold color="white">q</Text> Quit
          </Text>
          <Text dimColor>
            <Text bold color="white">r</Text> Refresh now
          </Text>
        </Box>
        <Text dimColor>Polling interval: {intervalMs}ms</Text>
      </Box>
    </Box>
  );
};
