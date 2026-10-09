import { apiServerPorts, SimpleLogger } from "@lmstudio/lms-common";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { createClient } from "./createClient.js";
import { findOrStartLocalAPIServer } from "./findOrStartLocalAPIServer.js";
import { readLocalAPIServerPort, tryFindLocalAPIServer } from "./localAPIServer.js";
import { getServerConfig } from "./subcommands/server.js";

// Scan fixture ports rather than unrelated apps running on the developer's machine.
jest.mock("@lmstudio/lms-common", () => ({
  ...jest.requireActual<typeof import("@lmstudio/lms-common")>("@lmstudio/lms-common"),
  apiServerPorts: [],
}));

const originalAPIInfoPath = process.env.LMS_API_SERVER_INFO_PATH;
const originalForceProd = process.env.LMS_FORCE_PROD;
const logger = new SimpleLogger("", { debug() {}, error() {}, info() {}, warn() {} });
const servers: Array<Server> = [];
const sockets: Array<WebSocketServer> = [];
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lms-coexistence-"));
  delete process.env.LMS_API_SERVER_INFO_PATH;
  process.env.LMS_FORCE_PROD = "1";
});

afterEach(async () => {
  for (const socketServer of sockets.splice(0)) {
    for (const client of socketServer.clients) {
      client.terminate();
    }
    socketServer.close();
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const internalFolder of [
    join(home, ".internal"),
    join(home, "apps", "bionic", ".internal"),
  ]) {
    try {
      const info = z
        .object({ pid: z.number() })
        .parse(JSON.parse(readFileSync(join(internalFolder, "http-server.json"), "utf-8")));
      if (info.pid !== process.pid) {
        process.kill(info.pid);
      }
    } catch {
      // A fixture may have no discovery file, or its process may already have exited.
    }
  }
  apiServerPorts.splice(0);
  if (originalAPIInfoPath === undefined) {
    delete process.env.LMS_API_SERVER_INFO_PATH;
  } else {
    process.env.LMS_API_SERVER_INFO_PATH = originalAPIInfoPath;
  }
  if (originalForceProd === undefined) {
    delete process.env.LMS_FORCE_PROD;
  } else {
    process.env.LMS_FORCE_PROD = originalForceProd;
  }
  rmSync(home, { force: true, recursive: true });
});

/** Serves discovery and a key-protected SDK endpoint using actual loopback transports. */
async function startApp(packageName: "lmstudio" | "bionic" | "daemon") {
  const internalFolder = join(
    home,
    ...(packageName === "bionic" ? ["apps", "bionic"] : []),
    ".internal",
  );
  mkdirSync(internalFolder, { recursive: true });
  const key = `${packageName}-key`;
  writeFileSync(join(internalFolder, "lms-key-2"), key);
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/lms-status"
          ? { package: packageName, version: "1.0.0" }
          : { lmstudio: true },
      ),
    );
  });
  servers.push(server);
  const socketServer = new WebSocketServer({ server });
  sockets.push(socketServer);
  socketServer.on("connection", socket => {
    let authenticated = false;
    socket.on("message", data => {
      const packet: unknown = JSON.parse(data.toString());
      if (!authenticated) {
        const authentication = z
          .object({ clientIdentifier: z.string(), clientPasskey: z.string() })
          .parse(packet);
        authenticated =
          authentication.clientIdentifier === "lms-cli" &&
          authentication.clientPasskey === `<LMS-CLI-LMS-KEY>${key}`;
        socket.send(
          JSON.stringify(
            authenticated ? { success: true } : { success: false, error: "Wrong app key" },
          ),
        );
        return;
      }
      const message = z.object({ type: z.string(), callId: z.number().optional() }).parse(packet);
      if (message.type === "rpcCall") {
        socket.send(
          JSON.stringify({
            type: "rpcResult",
            callId: message.callId,
            result: { pid: process.pid, isDaemon: packageName === "daemon", version: packageName },
          }),
        );
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture did not bind a TCP port.");
  }
  const infoFile = join(internalFolder, "http-server.json");
  writeFileSync(infoFile, JSON.stringify({ port: address.port, pid: process.pid }));
  writeFileSync(
    join(internalFolder, "http-server-config.json"),
    JSON.stringify({ port: address.port, networkInterface: "127.0.0.1" }),
  );
  return { internalFolder, infoFile, port: address.port };
}

/** Records an executable fixture that publishes discovery only after being launched by lms. */
function installApp(packageName: "lmstudio" | "bionic" | "daemon") {
  const internalFolder = join(
    home,
    ...(packageName === "bionic" ? ["apps", "bionic"] : []),
    ".internal",
  );
  mkdirSync(internalFolder, { recursive: true });
  const workingDirectory = join(home, packageName);
  mkdirSync(workingDirectory);
  writeFileSync(
    join(workingDirectory, "index.js"),
    `
    const { createServer } = require("http");
    const { writeFileSync } = require("fs");
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ package: ${JSON.stringify(packageName)}, version: "1.0.0" }));
    });
    server.listen(0, "127.0.0.1", () => {
      writeFileSync(${JSON.stringify(join(internalFolder, "lms-key-2"))}, "fresh-key");
      writeFileSync(${JSON.stringify(join(internalFolder, "http-server.json"))}, JSON.stringify({ port: server.address().port, pid: process.pid }));
    });
    setTimeout(() => process.exit(0), 10000);
  `,
  );
  const installFile = join(
    internalFolder,
    packageName === "daemon" ? "llmster-install-location.json" : "app-install-location.json",
  );
  writeFileSync(
    installFile,
    JSON.stringify({
      path: process.execPath,
      argv: [process.execPath, "."],
      cwd: workingDirectory,
    }),
  );
  return installFile;
}

// Covers discovery, correct authentication, and REST configuration selection for the running-app matrix.
test.each([
  [true, false, "bionic"],
  [false, true, "lmstudio"],
  [true, true, "lmstudio"],
] as const)(
  "Bionic running=%s, LM Studio running=%s selects %s",
  async (bionicRunning, lmstudioRunning, expectedApp) => {
    if (bionicRunning) {
      await startApp("bionic");
    }
    if (lmstudioRunning) {
      await startApp("lmstudio");
    }
    const selected = await tryFindLocalAPIServer({ logger, home });
    expect(selected?.package).toBe(expectedApp);
    if (selected === null) {
      throw new Error("No app discovered.");
    }
    const client = await createClient(logger, {}, { localAPIServer: selected });
    try {
      expect((await client.system.getInfo()).version).toBe(expectedApp);
      expect((await getServerConfig(logger, selected))?.port).toBe(selected.port);
    } finally {
      await client[Symbol.asyncDispose]();
    }
  },
);

test("prefers a legacy llmster endpoint over Bionic", async () => {
  await startApp("bionic");
  const daemon = await startApp("daemon");
  rmSync(daemon.infoFile);
  apiServerPorts.push(daemon.port);
  expect((await tryFindLocalAPIServer({ logger, home }))?.package).toBe("daemon");
});

test.each([2147483647, process.pid])(
  "prefers private Bionic discovery over a leftover shared record with PID %s",
  async publishedPid => {
    const bionic = await startApp("bionic");
    const devServer = await startApp("daemon");
    // A leftover shared record may point to a dev Bionic, even after its original PID is reused.
    servers[1].removeAllListeners("request");
    servers[1].on("request", (_request, response) => {
      response.end(JSON.stringify({ package: "bionic", version: "dev" }));
    });
    writeFileSync(devServer.infoFile, JSON.stringify({ pid: publishedPid, port: devServer.port }));
    apiServerPorts.push(devServer.port);
    expect((await tryFindLocalAPIServer({ logger, home }))?.port).toBe(bionic.port);
  },
);

test("an explicit instance wins, and a stale override never falls back", async () => {
  const bionic = await startApp("bionic");
  await startApp("lmstudio");
  process.env.LMS_API_SERVER_INFO_PATH = bionic.infoFile;
  expect((await findOrStartLocalAPIServer({ logger, home }))?.port).toBe(bionic.port);
  rmSync(bionic.infoFile);
  expect(await findOrStartLocalAPIServer({ logger, home })).toBeNull();
});

test("uses running Bionic instead of launching an installed LM Studio", async () => {
  const bionic = await startApp("bionic");
  installApp("lmstudio");
  expect((await findOrStartLocalAPIServer({ logger, home }))?.port).toBe(bionic.port);
  expect(readLocalAPIServerPort(join(home, ".internal", "http-server.json"))).toBeNull();
});

test.each(["daemon", "lmstudio", "bionic"] as const)(
  "cold start selects %s after skipping higher-priority stale installations",
  async expectedApp => {
    const daemonFile = installApp("daemon");
    const lmstudioFile = installApp("lmstudio");
    installApp("bionic");
    const staleInstallation = JSON.stringify({
      path: join(home, "missing-executable"),
      argv: [],
      cwd: home,
    });
    if (expectedApp !== "daemon") {
      writeFileSync(daemonFile, staleInstallation);
    }
    if (expectedApp === "bionic") {
      writeFileSync(lmstudioFile, staleInstallation);
    }
    const selected = await findOrStartLocalAPIServer({
      logger,
      home,
      maxAttempts: 100,
      pollIntervalMs: 20,
    });
    expect(selected?.package).toBe(expectedApp);
    if (selected === null) {
      throw new Error("App did not start.");
    }
    expect(readFileSync(join(selected.internalFolder, "lms-key-2"), "utf-8")).toBe("fresh-key");
    expect(readFileSync(daemonFile, "utf-8")).toContain(
      expectedApp === "daemon" ? process.execPath : "missing-executable",
    );
  },
);

test("returns no target when no app is running or installed", async () => {
  expect(await findOrStartLocalAPIServer({ logger, home })).toBeNull();
});

test.each([
  ["a missing file", undefined],
  ["invalid JSON", "{"],
  ["a missing port", JSON.stringify({ pid: process.pid })],
  ["port zero", JSON.stringify({ port: 0 })],
  ["a non-integer port", JSON.stringify({ port: 1234.5 })],
  ["a port above 65535", JSON.stringify({ port: 65536 })],
])("ignores %s", (_description, content) => {
  const infoFile = join(home, "http-server.json");
  if (content !== undefined) {
    writeFileSync(infoFile, content);
  }
  expect(readLocalAPIServerPort(infoFile)).toBeNull();
});
