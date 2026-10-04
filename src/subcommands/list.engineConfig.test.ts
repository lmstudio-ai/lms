import { type LLMLoadModelConfig } from "@lmstudio/sdk";
import { createClient } from "../createClient.js";
import { createDeviceNameResolver } from "../deviceNameLookup.js";
import { ps } from "./list.js";

jest.mock("../createClient.js", () => ({
  ...jest.requireActual<typeof import("../createClient.js")>("../createClient.js"),
  createClient: jest.fn(),
}));
jest.mock("../deviceNameLookup.js", () => ({
  ...jest.requireActual<typeof import("../deviceNameLookup.js")>("../deviceNameLookup.js"),
  createDeviceNameResolver: jest.fn(),
}));

// Exercise the command against its reported load configuration without running an engine.
function model(identifier: string, config: LLMLoadModelConfig, type = "llm") {
  return {
    identifier,
    getLoadConfig: async () => config,
    getContextLength: async () => 32768,
    getModelInfo: async () => ({
      type,
      identifier,
      instanceReference: "internal",
      modelKey: identifier,
      contextLength: 32768,
      sizeBytes: 1024,
      ttlMs: null,
      lastUsedTime: null,
      deviceIdentifier: null,
    }),
    getInstanceProcessingState: async () => ({ status: "idle", queued: 0 }),
  };
}

beforeEach(() => {
  ps.exitOverride();
  jest.mocked(createDeviceNameResolver).mockResolvedValue({
    label: () => "Local",
    isLocal: (deviceIdentifier: string | null) => deviceIdentifier === null,
  } as unknown as Awaited<ReturnType<typeof createDeviceNameResolver>>);
  jest.mocked(createClient).mockResolvedValue({
    [Symbol.asyncDispose]: async () => {},
    llm: {
      listLoaded: async () => [
        model("file-model", { engineConfigFileContents: "max-model-len: 32768\n" }),
        model("normal-model", { maxParallelPredictions: 4 }),
        model("cleared-model", { engineConfigFileContents: "", engineCwd: "/inactive" }),
      ],
    },
    embedding: { listLoaded: async () => [model("embedding-model", {}, "embedding")] },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
});
afterEach(() => jest.restoreAllMocks());

it("reports file mode, actual context, and unknown parallelism in JSON without YAML", async () => {
  const output = jest.spyOn(console, "info").mockImplementation(() => {});
  await ps.parseAsync(["node", "lms", "--json"]);
  const rows = JSON.parse(String(output.mock.calls[0][0])) as Array<{
    identifier: string;
    engineConfigFileEnabled: boolean;
    contextLength: number;
    parallel: number | null;
  }>;
  expect(rows.find(row => row.identifier === "file-model")).toMatchObject({
    engineConfigFileEnabled: true,
    contextLength: 32768,
    parallel: null,
  });
  expect(rows.find(row => row.identifier === "normal-model")).toMatchObject({
    engineConfigFileEnabled: false,
    parallel: 4,
  });
  expect(
    rows.filter(row => row.identifier !== "file-model").every(row => !row.engineConfigFileEnabled),
  ).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("max-model-len");
  expect(JSON.stringify(rows)).not.toContain("engineConfigFileContents");
});

it("identifies both modes in the table and keeps absent parallelism unknown", async () => {
  const output = jest.spyOn(console, "info").mockImplementation(() => {});
  await ps.parseAsync(["node", "lms"]);
  const table = output.mock.calls.map(args => args.join(" ")).join("\n");
  expect(table).toContain("LOAD CONFIG");
  expect(table).toMatch(/file-model.*32768\s+-\s+File/);
  expect(table).toMatch(/normal-model.*32768\s+4\s+LM Studio/);
  expect(table).toMatch(/cleared-model.*32768\s+-\s+LM Studio/);
  expect(table).not.toContain("max-model-len");
});
