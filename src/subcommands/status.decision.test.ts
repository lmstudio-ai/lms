import { type SimpleLogger } from "@lmstudio/lms-common";
import { checkHttpServer, createClient } from "../createClient.js";
import type * as CreateClientModule from "../createClient.js";
import { createLogger } from "../logLevel.js";
import type * as LogLevelModule from "../logLevel.js";
import { status as linkStatus } from "./link/status.js";
import { status } from "./status.js";

jest.mock("../createClient.js", () => ({
  ...jest.requireActual<typeof CreateClientModule>("../createClient.js"),
  createClient: jest.fn(),
  checkHttpServer: jest.fn(),
}));
jest.mock("../logLevel.js", () => ({
  ...jest.requireActual<typeof LogLevelModule>("../logLevel.js"),
  createLogger: jest.fn(),
}));

const logger = { info: jest.fn(), debug: jest.fn() };
const decision = {
  identifier: "decision-instance",
  path: "test/decision.gguf",
  getModelInfo: async () => ({ deviceIdentifier: "peer" }),
};

beforeEach(() => {
  jest.clearAllMocks();
  linkStatus.setOptionValue("json", false);
  jest.mocked(createLogger).mockReturnValue(logger as unknown as SimpleLogger);
  jest.mocked(checkHttpServer).mockResolvedValue(true);
  jest.mocked(createClient).mockResolvedValue({
    [Symbol.asyncDispose]: async () => {},
    llm: { listLoaded: async () => [] },
    embedding: { listLoaded: async () => [] },
    decision: { listLoaded: async () => [decision] },
    system: { listDownloadedModels: async () => [] },
    repository: {
      lmLink: {
        status: async () => ({
          status: "online",
          issues: [],
          deviceName: "Local",
          peers: [{ deviceIdentifier: "peer", deviceName: "Test peer", status: "online" }],
        }),
      },
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  jest.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("includes decisions in server status", async () => {
  await status.parseAsync(["node", "lms", "--port", "1234"]);
  expect(console.info).toHaveBeenCalledWith(expect.stringContaining("decision-instance"));
});

it("includes decisions in LM Link peer status", async () => {
  await linkStatus.parseAsync(["node", "lms"]);
  expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("decision-instance"));
});

it("includes decisions in LM Link peer JSON", async () => {
  await linkStatus.parseAsync(["node", "lms", "--json"]);
  const output = JSON.parse(String(jest.mocked(console.info).mock.calls[0][0]));
  expect(output.peers).toEqual([
    expect.objectContaining({
      deviceIdentifier: "peer",
      loadedModels: ["decision-instance"],
    }),
  ]);
});
