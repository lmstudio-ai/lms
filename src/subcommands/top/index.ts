import { Command, Option, type OptionValues } from "@commander-js/extra-typings";
import chalk from "chalk";
import columnify from "columnify";
import { render } from "ink";
import React from "react";
import {
  addCreateClientOptions,
  createClient,
  DEFAULT_SERVER_PORT,
  type CreateClientArgs,
} from "../../createClient.js";
import { formatSizeBytes1000, formatSizeBytes1024 } from "../../formatBytes.js";
import { formatTimeLean } from "../../formatElapsedTime.js";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { createRefinedNumberParser } from "../../types/refinedNumber.js";
import { getServerConfig } from "../server.js";
import { TopDataCollector } from "./dataFetcher.js";
import { TopDashboard } from "./react/TopDashboard.js";
import { type TopSnapshot } from "./types.js";

type TopCommandOptions = OptionValues &
  CreateClientArgs &
  LogLevelArgs & {
    interval: number;
    once?: boolean;
    json?: boolean;
  };

const topCommand = new Command<[], TopCommandOptions>()
  .name("top")
  .description("Real-time system, VRAM, and server throughput dashboard")
  .addOption(
    new Option("-i, --interval <ms>", "Update interval in milliseconds")
      .argParser(createRefinedNumberParser({ integer: true, min: 250, max: 60000 }))
      .default(1000),
  )
  .option("--once", "Print a single snapshot of the dashboard and exit")
  .option("--json", "Output the raw snapshot in JSON format and exit");

addCreateClientOptions(topCommand);
addLogLevelOptions(topCommand);

function printSnapshotText(snapshot: TopSnapshot): void {
  const { server, hardware, loadedModels, throughput } = snapshot;
  const isOnline = server.status === "online";

  console.info();
  console.info(
    `${chalk.bold.hex("#22D3EE")("LM STUDIO TOP")}  |  ${
      isOnline ? chalk.bold.green("● SERVER ONLINE") : chalk.bold.red("○ SERVER OFFLINE")
    } (http://${server.host}:${server.port})${
      server.pid !== null ? `  PID: ${server.pid}` : ""
    }${server.version !== null ? `  v${server.version}` : ""}`,
  );
  console.info();

  // Hardware
  if (hardware !== null) {
    console.info(chalk.bold.hex("#818CF8")("HARDWARE"));
    if (hardware.gpus.length > 0) {
      for (const gpu of hardware.gpus) {
        const total = gpu.dedicatedMemoryBytes > 0 ? gpu.dedicatedMemoryBytes : gpu.totalMemoryBytes;
        console.info(
          `  GPU: ${gpu.name} (${gpu.detectionPlatform}, ${gpu.integrationType}) - Dedicated VRAM: ${formatSizeBytes1024(total)}`,
        );
      }
    }
    const totalModelsSizeBytes = loadedModels.reduce((acc, m) => acc + (m.sizeBytes || 0), 0);
    const totalVram =
      hardware.vramCapacityBytes > 0
        ? hardware.vramCapacityBytes
        : hardware.gpus.reduce(
            (acc, g) => acc + (g.dedicatedMemoryBytes > 0 ? g.dedicatedMemoryBytes : g.totalMemoryBytes),
            0,
          );
    if (totalModelsSizeBytes > 0 && totalVram > 0) {
      const isOffloaded = totalModelsSizeBytes > totalVram;
      console.info(
        `  Model Footprint (Est.): ${formatSizeBytes1024(totalModelsSizeBytes)} / ${formatSizeBytes1024(totalVram)} Total VRAM${
          isOffloaded ? chalk.yellow(" [CPU/RAM offloaded]") : ""
        }`,
      );
    }
    console.info(
      `  RAM: ${formatSizeBytes1024(hardware.ramCapacityBytes)}  |  CPU: ${hardware.cpuArchitecture}`,
    );
    console.info();
  }

  // Throughput
  console.info(chalk.bold.hex("#34D399")("INFERENCE & THROUGHPUT"));
  console.info(
    `  Active: ${throughput.activePredictions}  |  Speed: ${throughput.currentTokensPerSec.toFixed(1)} tok/s (avg: ${throughput.avgTokensPerSec.toFixed(1)} tok/s)  |  Session: ${throughput.totalTokensGenerated} tokens`,
  );
  console.info();

  // Loaded models
  console.info(chalk.bold.hex("#F9A8D4")(`LOADED MODELS (${loadedModels.length})`));
  if (loadedModels.length === 0) {
    console.info(chalk.dim("  No models currently loaded."));
  } else {
    const rows = loadedModels.map(m => {
      const timeLeft =
        m.ttlMs !== undefined && m.ttlMs !== null
          ? m.lastUsedTime === null || m.lastUsedTime === undefined
            ? m.ttlMs
            : m.ttlMs - (Date.now() - m.lastUsedTime)
          : null;

      const ttlText =
        timeLeft !== null && timeLeft > 0
          ? formatTimeLean(timeLeft)
          : m.ttlMs === null || m.ttlMs === undefined
          ? "∞"
          : "expiring";

      return {
        identifier: m.identifier,
        status: m.status === "PROCESSING" ? chalk.yellow("PROCESSING") : chalk.green("IDLE"),
        size: formatSizeBytes1000(m.sizeBytes),
        context: m.contextLength ? `${m.contextLength} ctx` : "-",
        parallel: String(m.parallel),
        ttl: ttlText,
      };
    });

    console.info(
      columnify(rows, {
        columns: ["identifier", "status", "size", "context", "parallel", "ttl"],
        config: {
          identifier: { headingTransform: () => chalk.dim("IDENTIFIER") },
          status: { headingTransform: () => chalk.dim("STATUS") },
          size: { headingTransform: () => chalk.dim("SIZE") },
          context: { headingTransform: () => chalk.dim("CONTEXT") },
          parallel: { headingTransform: () => chalk.dim("PARALLEL") },
          ttl: { headingTransform: () => chalk.dim("TTL") },
        },
        columnSplitter: "   ",
      }),
    );
  }
  console.info();
}

topCommand.action(async (options: TopCommandOptions) => {
  const logger = createLogger(options);
  let { host, port } = options;
  if (host === undefined) {
    host = "127.0.0.1";
  }
  if (port === undefined) {
    if (host === "127.0.0.1") {
      try {
        port = (await getServerConfig(logger))?.port ?? DEFAULT_SERVER_PORT;
      } catch (e) {
        logger.debug("Failed to read last server config", e);
        port = DEFAULT_SERVER_PORT;
      }
    } else {
      port = DEFAULT_SERVER_PORT;
    }
  }

  // Create LMStudio client
  const client = await createClient(logger, options);
  const collector = new TopDataCollector(client, logger, host, port);

  // Single snapshot mode
  if (options.json === true) {
    const snapshot = await collector.fetchSnapshot();
    console.info(JSON.stringify(snapshot, null, 2));
    await client[Symbol.asyncDispose]();
    return;
  }

  if (options.once === true || !process.stdin.isTTY) {
    const snapshot = await collector.fetchSnapshot();
    printSnapshotText(snapshot);
    await client[Symbol.asyncDispose]();
    return;
  }

  // Interactive TUI dashboard mode
  const initialSnapshot = await collector.fetchSnapshot();
  const intervalMs = options.interval;

  await new Promise<void>(resolve => {
    const instance = render(
      React.createElement(TopDashboard, {
        collector,
        initialSnapshot,
        intervalMs,
      }),
      {
        exitOnCtrlC: true,
      },
    );

    instance.waitUntilExit().then(async () => {
      collector.stopListening();
      try {
        await client[Symbol.asyncDispose]();
      } catch {
        // Ignore cleanup error on exit
      }
      resolve();
    });
  });
});

export const top = topCommand;
