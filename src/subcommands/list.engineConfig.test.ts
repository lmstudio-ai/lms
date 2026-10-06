import { type LLMLoadModelConfig } from "@lmstudio/sdk";
import { createClient } from "../createClient.js";
import type * as CreateClientModule from "../createClient.js";
import { createDeviceNameResolver } from "../deviceNameLookup.js";
import type * as DeviceNameLookupModule from "../deviceNameLookup.js";
import { ls, ps } from "./list.js";

jest.mock("../createClient.js", () => ({
  ...jest.requireActual<typeof CreateClientModule>("../createClient.js"),
  createClient: jest.fn(),
}));
jest.mock("../deviceNameLookup.js", () => ({
  ...jest.requireActual<typeof DeviceNameLookupModule>("../deviceNameLookup.js"),
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

const modelTypes = ["llm", "embedding", "decision"] as const;

beforeEach(() => {
  for (const command of [ls, ps]) {
    for (const option of command.options) {
      command.setOptionValue(option.attributeName(), option.defaultValue);
    }
  }
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
    decision: {
      listLoaded: async () => [model("decision-model", { maxParallelPredictions: 2 }, "decision")],
    },
    system: {
      listDownloadedModels: async () =>
        modelTypes.map(type => ({
          type,
          modelKey: `${type}-model`,
          sizeBytes: 1024,
          deviceIdentifier: null,
        })),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
});
afterEach(() => jest.restoreAllMocks());

it.each(modelTypes)("filters downloaded %s models", async type => {
  const output = jest.spyOn(console, "info").mockImplementation(() => {});
  await ls.parseAsync(["node", "lms", `--${type}`, "--json"]);
  const rows = JSON.parse(String(output.mock.calls[0][0])) as Array<{ type: string }>;
  expect(rows.map(row => row.type)).toEqual([type]);
});

it("lists all supported model types without a filter", async () => {
  const output = jest.spyOn(console, "info").mockImplementation(() => {});
  await ls.parseAsync(["node", "lms"]);
  const table = output.mock.calls.map(args => args.join(" ")).join("\n");
  for (const type of modelTypes) {
    expect(table).toContain(type.toUpperCase());
    expect(table).toContain(`${type}-model`);
  }
});

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
  expect(rows.find(row => row.identifier === "decision-model")).toMatchObject({
    engineConfigFileEnabled: false,
    contextLength: 32768,
    parallel: 2,
    status: "idle",
    queued: 0,
  });
  expect(JSON.stringify(rows)).not.toContain("instanceReference");
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
  expect(table).toMatch(/decision-model.*32768\s+2\s+LM Studio/);
  expect(table).not.toContain("max-model-len");
});
