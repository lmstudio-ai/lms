import { BufferedEvent, SimpleLogger } from "@lmstudio/lms-common";
import { AuthenticatedWsServer, type Context } from "@lmstudio/lms-communication-server";
import { createRepositoryBackendInterface } from "@lmstudio/lms-external-backend-interfaces";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { createServer, type Server } from "http";
import { type Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { askQuestion } from "../../confirm.js";
import { agent } from "./agent.js";

jest.mock("../../confirm.js", () => ({ askQuestion: jest.fn() }));

const logger = new SimpleLogger("", { debug() {}, error() {}, info() {}, warn() {} });
const sockets = new Set<Socket>();
const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
let server: Server;
let folder: string;
let state: { enabled: boolean; managed: boolean };
let requestError: Error | undefined;
let output: jest.SpyInstance<boolean, Parameters<typeof process.stderr.write>>;

/** Gives the real CLI client a loopback API; only the interactive answer is simulated. */
beforeEach(async () => {
  state = { enabled: false, managed: false };
  requestError = undefined;
  jest.mocked(askQuestion).mockReset().mockResolvedValue(false);
  agent.commands.forEach(command => command.setOptionValue("yes", false));
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  output = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  folder = await mkdtemp(join(tmpdir(), "lms-link-agent-"));
  jest.replaceProperty(process, "env", {
    ...process.env,
    LMS_API_SERVER_INFO_PATH: join(folder, "http-server.json"),
  });
  const backend = createRepositoryBackendInterface().withContextType<Context>();
  /** Serves the host's current agent setting to the SDK. */
  backend.handleRpcEndpoint("lmLinkGetAgentStatus", async () => {
    if (requestError !== undefined) {
      throw requestError;
    }
    return state;
  });
  /** Records successful mutations so tests can observe their effect through the API. */
  backend.handleRpcEndpoint("lmLinkSetAgentEnabled", async (_context, { enabled }) => {
    if (requestError !== undefined) {
      throw requestError;
    }
    state = { ...state, enabled };
  });
  server = createServer((_request, response) => {
    response.end(JSON.stringify({ lmstudio: true, package: "daemon", version: "1.0.0" }));
  });
  server.on("connection", socket => sockets.add(socket));
  new AuthenticatedWsServer({
    server,
    pathName: "repository",
    backendInterface: backend,
    parentLogger: logger,
    authenticator: {
      /** Keeps authentication local to this test server. */
      async authenticate() {
        return {
          holder: { drop() {}, leak() {} },
          contextCreator: () => ({ logger }),
          authenticationRevokedEvent: BufferedEvent.create<void>()[0],
        };
      },
    },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not bind a TCP port.");
  }
  await writeFile(join(folder, "http-server.json"), JSON.stringify({ port: address.port }));
});

/** Releases sockets and restores terminal state so commands cannot leak across tests. */
afterEach(async () => {
  for (const socket of sockets) {
    socket.destroy();
  }
  sockets.clear();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(folder, { recursive: true, force: true });
  if (stdinDescriptor === undefined) {
    Reflect.deleteProperty(process.stdin, "isTTY");
  } else {
    Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
  }
  jest.restoreAllMocks();
});

/** Queries must distinguish the host opt-in from managed Runner policy. */
test.each([
  { enabled: false, managed: false },
  { enabled: true, managed: false },
  { enabled: false, managed: true },
  { enabled: true, managed: true },
])("reports agent status %j", async status => {
  state = status;
  await agent.parseAsync([], { from: "user" });
  const text = output.mock.calls.map(([chunk]) => String(chunk)).join("");
  expect(text).toContain(`Agentic use is ${status.enabled ? "enabled" : "disabled"}`);
  expect(text.includes("managed by Runner policy")).toBe(status.managed);
});

/** Both explicit approval and --yes allow the command to change the host setting. */
test.each([false, true])("enables agentic use with --yes=%s", async yes => {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: !yes });
  jest.mocked(askQuestion).mockResolvedValue(true);
  await agent.parseAsync(yes ? ["enable", "--yes"] : ["enable"], { from: "user" });
  expect(state.enabled).toBe(true);
});

/** The shared prompt returns false for both N and Ctrl+C; neither may grant access. */
test("does not mutate after cancellation", async () => {
  await agent.parseAsync(["enable"], { from: "user" });
  expect(state.enabled).toBe(false);
  expect(output.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("Canceled.");
});

/** Piped input cannot approve access implicitly. */
test("requires --yes when enabling non-interactively", async () => {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
  await expect(agent.parseAsync(["enable"], { from: "user" })).rejects.toThrow("--yes");
  expect(state.enabled).toBe(false);
});

/** Revoking access must work without an interactive terminal. */
test("disables agentic use without confirmation", async () => {
  state.enabled = true;
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
  jest.mocked(askQuestion).mockRejectedValue(new Error("No terminal available"));
  await agent.parseAsync(["disable"], { from: "user" });
  expect(state.enabled).toBe(false);
});

/** A rejected RPC must reach the caller without a success message. */
test.each([
  { commandArguments: [] },
  { commandArguments: ["enable", "--yes"] },
  { commandArguments: ["disable"] },
])("propagates API errors for $commandArguments", async ({ commandArguments }) => {
  requestError = new Error("Permission denied");
  await expect(agent.parseAsync(commandArguments, { from: "user" })).rejects.toThrow(
    "Permission denied",
  );
  expect(state.enabled).toBe(false);
  expect(output.mock.calls.map(([chunk]) => String(chunk)).join("")).not.toContain(
    "Agentic use is",
  );
});
