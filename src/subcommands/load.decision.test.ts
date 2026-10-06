import { search } from "@inquirer/prompts";
import { type DecisionModelInfo } from "@lmstudio/sdk";
import { getCliPref } from "../cliPref.js";
import { createClient } from "../createClient.js";
import type * as CreateClientModule from "../createClient.js";
import { createDeviceNameResolver } from "../deviceNameLookup.js";
import { load } from "./load.js";

jest.mock("@inquirer/prompts", () => ({ search: jest.fn() }));
jest.mock("../createClient.js", () => ({
  ...jest.requireActual<typeof CreateClientModule>("../createClient.js"),
  createClient: jest.fn(),
}));
jest.mock("../cliPref.js", () => ({ getCliPref: jest.fn() }));
jest.mock("../deviceNameLookup.js", () => ({ createDeviceNameResolver: jest.fn() }));
jest.mock("../Spinner.js", () => ({
  Spinner: class {
    setText() {}
    stop() {}
    stopIfNotStopped() {}
  },
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
};
const loadDecision = jest.fn(async () => ({
  getModelInfo: async () => ({ ...info, identifier: "decision-instance" }),
}));
const estimateDecision = jest.fn(async () => ({
  memory: { totalVramBytes: 1024, totalBytes: 2048, confidence: "high" },
  passesGuardrails: true,
}));
const loadOther = jest.fn();
const estimateOther = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  for (const option of load.options) {
    load.setOptionValue(option.attributeName(), option.defaultValue);
  }
  jest.mocked(createClient).mockResolvedValue({
    [Symbol.asyncDispose]: async () => {},
    system: { listDownloadedModels: async () => [info] },
    llm: { load: loadOther, estimateResourcesUsage: estimateOther },
    embedding: { load: loadOther, estimateResourcesUsage: estimateOther },
    decision: { load: loadDecision, estimateResourcesUsage: estimateDecision },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  jest.mocked(getCliPref).mockResolvedValue({
    get: () => ({ lastLoadedModels: [] }),
    setWithProducer: jest.fn(),
  } as unknown as Awaited<ReturnType<typeof getCliPref>>);
  jest.mocked(createDeviceNameResolver).mockResolvedValue({
    isLocal: (deviceIdentifier: string | null) => deviceIdentifier === null,
    label: () => "Test peer",
  } as unknown as Awaited<ReturnType<typeof createDeviceNameResolver>>);
  jest.mocked(search).mockResolvedValue(info);
  jest.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it.each([["--exact", info.path], [info.modelKey, "--yes"], []])(
  "loads decisions through their namespace for selection arguments %j",
  async (...selection) => {
    await load.parseAsync([
      "node",
      "lms",
      "--quiet",
      ...selection,
      "--gpu",
      "0.5",
      "--context-length",
      "512",
      "--parallel",
      "2",
      "--ttl",
      "60",
      "--identifier",
      "decision-instance",
    ]);
    expect(loadDecision).toHaveBeenCalledWith(
      info.modelKey,
      expect.objectContaining({
        deviceIdentifier: "peer",
        identifier: "decision-instance",
        ttl: 60,
        config: expect.objectContaining({
          gpu: { ratio: 0.5 },
          contextLength: 512,
          maxParallelPredictions: 2,
        }),
      }),
    );
    expect(loadOther).not.toHaveBeenCalled();
  },
);

it.each([
  ["--exact", info.path],
  [info.modelKey, "--yes"],
])("estimates decision resources without loading for arguments %j", async (...selection) => {
  await load.parseAsync(["node", "lms", "--quiet", ...selection, "--estimate-only", "--auto"]);
  expect(estimateDecision).toHaveBeenCalledWith(
    info.modelKey,
    expect.objectContaining({ autoFit: true }),
    { deviceIdentifier: "peer" },
  );
  expect(loadDecision).not.toHaveBeenCalled();
  expect(estimateOther).not.toHaveBeenCalled();
});
