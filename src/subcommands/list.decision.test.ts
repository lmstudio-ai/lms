import { type DecisionModelInfo } from "@lmstudio/sdk";
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

const info: DecisionModelInfo = {
  type: "decision",
  modelKey: "test/decision",
  path: "test/decision.gguf",
  indexedModelIdentifier: "test/decision",
  deviceIdentifier: "peer",
  displayName: "Test decision model",
  publisher: "test",
  format: "gguf",
  sizeBytes: 1024,
  hasVisionAdapter: false,
  variants: ["test/decision:q4"],
};
const variant = { ...info, modelKey: "test/decision:q4", variants: undefined };
const instance = {
  ...variant,
  identifier: "decision-instance",
  instanceReference: "internal-reference",
  contextLength: 512,
  ttlMs: null,
  lastUsedTime: null,
};
const loaded = {
  identifier: instance.identifier,
  getModelInfo: async () => instance,
  getLoadConfig: async () => ({ maxParallelPredictions: 2 }),
  getContextLength: async () => instance.contextLength,
  getInstanceProcessingState: async () => ({ status: "idle", queued: 0 }),
};
const downloaded = [
  { ...info, type: "llm", modelKey: "test/llm", variants: undefined },
  { ...info, type: "embedding", modelKey: "test/embedding", variants: undefined },
  info,
];

beforeEach(() => {
  for (const command of [ls, ps]) {
    for (const option of command.options) {
      command.setOptionValue(option.attributeName(), option.defaultValue);
    }
  }
  jest.mocked(createClient).mockResolvedValue({
    [Symbol.asyncDispose]: async () => {},
    llm: { listLoaded: async () => [] },
    embedding: { listLoaded: async () => [] },
    decision: { listLoaded: async () => [loaded] },
    system: {
      listDownloadedModels: async () => downloaded,
      listDownloadedModelVariants: async () => [variant],
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  jest.mocked(createDeviceNameResolver).mockResolvedValue({
    isLocal: (deviceIdentifier: string | null) => deviceIdentifier === null,
    label: () => "Test peer",
  } as unknown as Awaited<ReturnType<typeof createDeviceNameResolver>>);
  jest.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it.each([
  { args: [], types: ["llm", "embedding", "decision"] },
  { args: ["--decision"], types: ["decision"] },
  { args: ["--llm", "--decision"], types: ["llm", "decision"] },
])("lists model types $types for arguments $args", async ({ args, types }) => {
  await ls.parseAsync(["node", "lms", ...args, "--json"]);
  const rows = JSON.parse(
    String(jest.mocked(console.info).mock.calls[0][0]),
  ) as DecisionModelInfo[];
  expect(rows.map(row => row.type)).toEqual(types);
});

it.each([[], ["--variants"], [info.modelKey]])(
  "lists decisions and their variants with the correct heading for arguments %j",
  async (...args) => {
    await ls.parseAsync(["node", "lms", ...args]);
    const table = jest
      .mocked(console.info)
      .mock.calls.map(args => args.join(" "))
      .join("\n");
    expect(table).toContain("DECISION");
    expect(table).toContain(info.modelKey);
    if (args.length > 0) {
      expect(table).toContain(variant.modelKey);
      expect(table).toContain("LOADED");
    }
    expect(table).toContain("Test peer");
  },
);

it("includes decision variants in filtered JSON", async () => {
  await ls.parseAsync(["node", "lms", "--decision", "--variants", "--json"]);
  expect(JSON.parse(String(jest.mocked(console.info).mock.calls[0][0]))).toEqual([
    { model: info, variants: [variant] },
  ]);
});

it("reports decision processing state and parallelism in ps JSON without internal references", async () => {
  await ps.parseAsync(["node", "lms", "--json"]);
  const rows = JSON.parse(String(jest.mocked(console.info).mock.calls[0][0]));
  expect(rows).toEqual([
    expect.objectContaining({
      type: "decision",
      identifier: "decision-instance",
      contextLength: 512,
      deviceIdentifier: "peer",
      status: "idle",
      queued: 0,
      parallel: 2,
      engineConfigFileEnabled: false,
    }),
  ]);
  expect(rows[0]).not.toHaveProperty("instanceReference");
});

it("reports decisions in the ps table", async () => {
  await ps.parseAsync(["node", "lms"]);
  const table = jest
    .mocked(console.info)
    .mock.calls.map(args => args.join(" "))
    .join("\n");
  expect(table).toMatch(/decision-instance.*IDLE.*512\s+2\s+LM Studio\s+Test peer/);
});
