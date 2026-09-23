import { search } from "@inquirer/prompts";
import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LLMLoadModelConfig, type ModelInfo } from "@lmstudio/sdk";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getCliPref } from "../cliPref.js";
import { createClient } from "../createClient.js";
import { createDeviceNameResolver } from "../deviceNameLookup.js";
import { createLogger } from "../logLevel.js";
import { load } from "./load.js";

jest.mock("@inquirer/prompts", () => ({ search: jest.fn() }));
jest.mock("node:fs/promises", () => ({
  ...jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises"),
  readFile: jest.fn(),
}));
jest.mock("../createClient.js", () => ({
  ...jest.requireActual<typeof import("../createClient.js")>("../createClient.js"),
  createClient: jest.fn(),
}));
jest.mock("../logLevel.js", () => ({
  ...jest.requireActual<typeof import("../logLevel.js")>("../logLevel.js"),
  createLogger: jest.fn(),
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

const yaml = "# preserve comments and line endings\r\nchat-template: ./templates/custom.jinja\r\n";
const modelInfo: ModelInfo & { identifier: string } = {
  type: "llm",
  modelKey: "test/model",
  path: "test/model",
  indexedModelIdentifier: "test/model",
  deviceIdentifier: null,
  architecture: "qwen3",
  sizeBytes: 1024,
  identifier: "test-instance",
  format: "torch_safetensors",
  displayName: "Test model",
  publisher: "test",
  vision: true,
  trainedForToolUse: true,
  maxContextLength: 4096,
};
const logger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  warnText: jest.fn(),
  errorWithoutPrefix: jest.fn(),
};
const loadedConfig = jest.fn<Promise<LLMLoadModelConfig>, []>();
const loadModel = jest.fn<
  Promise<{
    getModelInfo: () => Promise<ModelInfo>;
    getLoadConfig: typeof loadedConfig;
  }>,
  [string, { config: LLMLoadModelConfig; deviceIdentifier?: string | null }]
>();
const estimate = jest.fn();
const downloaded = jest.fn<Promise<ModelInfo[]>, []>();
const parse = (...args: string[]) => load.parseAsync(["node", "lms", ...args]);

beforeEach(() => {
  jest.clearAllMocks();
  load.exitOverride();
  load.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  jest.mocked(readFile).mockResolvedValue(yaml);
  jest.mocked(createLogger).mockReturnValue(logger as unknown as SimpleLogger);
  jest.mocked(getCliPref).mockResolvedValue({
    get: () => ({ lastLoadedModels: [] }),
    setWithProducer: jest.fn(),
  } as unknown as Awaited<ReturnType<typeof getCliPref>>);
  jest.mocked(createDeviceNameResolver).mockResolvedValue({
    isLocal: (deviceIdentifier: string | null) => deviceIdentifier === null,
    label: () => "Test host",
  } as unknown as Awaited<ReturnType<typeof createDeviceNameResolver>>);
  loadedConfig.mockResolvedValue({});
  loadModel.mockReset().mockResolvedValue({
    getModelInfo: async () => modelInfo,
    getLoadConfig: loadedConfig,
  });
  estimate.mockReset();
  downloaded.mockResolvedValue([modelInfo]);
  jest.mocked(createClient).mockResolvedValue({
    [Symbol.asyncDispose]: async () => {},
    system: { listDownloadedModels: downloaded },
    llm: { load: loadModel, estimateResourcesUsage: estimate },
    embedding: { load: loadModel, estimateResourcesUsage: estimate },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  jest.mocked(search).mockResolvedValue(modelInfo);
});

afterEach(() => jest.restoreAllMocks());

it.each(["engine-config-file", "engine-cwd"])(
  "rejects both orders of conflicting --%s flags",
  async flag => {
    for (const args of [
      [`--${flag}`, "some path", `--no-${flag}`],
      [`--no-${flag}`, `--${flag}`, "some path"],
    ]) {
      await expect(parse("test/model", ...args)).rejects.toThrow("mutually exclusive");
      expect(createClient).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
    }
  },
);

it.each([["--exact", "test/model"], ["test/model", "--yes"], []])(
  "imports one unchanged snapshot for selection arguments %j",
  async (...selection) => {
    await parse(
      ...selection,
      "--engine-config-file",
      "configs/my config.yaml",
      "--engine-cwd",
      ".",
      "--context-length",
      "512",
      "--parallel",
      "3",
    );
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(resolve("configs/my config.yaml"), "utf8");
    expect(loadModel).toHaveBeenCalledWith(
      "test/model",
      expect.objectContaining({
        config: expect.objectContaining({
          engineConfigFileContents: yaml,
          engineCwd: ".",
          contextLength: 512,
          maxParallelPredictions: 3,
        }),
      }),
    );
  },
);

it("leaves omitted fields unset and notices inherited mode from the loaded report", async () => {
  loadedConfig.mockResolvedValue({ engineConfigFileContents: yaml });
  await parse("test/model", "--yes");
  const config = loadModel.mock.calls[0][1].config;
  expect(config).not.toHaveProperty("engineConfigFileContents");
  expect(config.engineCwd).toBeUndefined();
  expect(readFile).not.toHaveBeenCalled();
  expect(
    logger.info.mock.calls.filter(
      ([message]) =>
        message === "Using a configuration file; LM Studio load-tuning settings are ignored.",
    ),
  ).toHaveLength(1);
});

it.each([
  {
    args: ["--no-engine-config-file"],
    expected: { engineConfigFileContents: "" },
    absent: "engineCwd",
  },
  { args: ["--no-engine-cwd"], expected: { engineCwd: "" }, absent: "engineConfigFileContents" },
  {
    args: ["--engine-cwd", "relative dir"],
    expected: { engineCwd: "relative dir" },
    absent: "engineConfigFileContents",
  },
])("keeps reset and inheritance independent: $args", async ({ args, expected, absent }) => {
  await parse("test/model", "--yes", ...args);
  expect(loadModel.mock.calls[0][1].config).toEqual(expect.objectContaining(expected));
  expect(loadModel.mock.calls[0][1].config[absent as keyof LLMLoadModelConfig]).toBeUndefined();
  expect(readFile).not.toHaveBeenCalled();
});

it("allows disabling mode while independently supplying a CWD", async () => {
  await parse("test/model", "--yes", "--no-engine-config-file", "--engine-cwd", ".");
  expect(loadModel.mock.calls[0][1].config).toEqual(
    expect.objectContaining({ engineConfigFileContents: "", engineCwd: "." }),
  );
  expect(logger.info).not.toHaveBeenCalledWith(
    expect.stringContaining("Using a configuration file"),
  );
});

it("preserves backend selection of the preferred device without reading host YAML", async () => {
  downloaded.mockResolvedValue([modelInfo, { ...modelInfo, deviceIdentifier: "peer" }]);
  loadModel.mockRejectedValue(new Error("system.manage: remote authoring is not allowed"));
  await expect(parse("test/model", "--yes", "--engine-config-file", "config.yaml")).rejects.toThrow(
    "system.manage",
  );
  expect(loadModel).toHaveBeenCalledTimes(1);
  expect(loadModel.mock.calls[0][1].deviceIdentifier).toBeUndefined();
  expect(loadedConfig).not.toHaveBeenCalled();
});

it.each([[], ["--engine-config-file", "config.yaml"]])(
  "propagates config-mode estimation errors with flags %j",
  async (...flags) => {
    estimate.mockRejectedValue(
      new Error("Resource estimation is unavailable in config-file mode."),
    );
    await expect(parse("test/model", "--yes", "--estimate-only", ...flags)).rejects.toThrow(
      "Resource estimation is unavailable",
    );
    expect(loadModel).not.toHaveBeenCalled();
  },
);

it("fails an unreadable source file before starting a load", async () => {
  jest.mocked(readFile).mockRejectedValue(new Error("ENOENT: config.yaml"));
  await expect(parse("test/model", "--yes", "--engine-config-file", "config.yaml")).rejects.toThrow(
    "ENOENT",
  );
  expect(createClient).not.toHaveBeenCalled();
});

it.each([[], ["--estimate-only"]])(
  "rejects an empty import before contacting the daemon with flags %j",
  async (...flags) => {
    jest.mocked(readFile).mockResolvedValue("");
    await expect(
      parse("test/model", "--yes", "--engine-config-file", "empty.yaml", ...flags),
    ).rejects.toThrow(
      "Engine configuration file is empty. Use --no-engine-config-file to disable config-file mode.",
    );
    expect(createClient).not.toHaveBeenCalled();
    expect(loadModel).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
  },
);

it("keeps existing argument validation even when YAML is supplied", async () => {
  await expect(
    parse("test/model", "--engine-config-file", "config.yaml", "--auto", "--gpu", "max"),
  ).rejects.toThrow("cannot be used");
  await expect(
    parse("test/model", "--engine-config-file", "config.yaml", "--context-length", "0"),
  ).rejects.toThrow();
  expect(readFile).not.toHaveBeenCalled();
});

it("rejects explicit engine options for embedding models rather than dropping them", async () => {
  downloaded.mockResolvedValue([{ ...modelInfo, type: "embedding" }]);
  jest.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit");
  });
  await expect(parse("test/model", "--yes", "--no-engine-config-file")).rejects.toThrow("exit");
  expect(logger.errorWithoutPrefix).toHaveBeenCalledWith(
    expect.stringContaining("Engine configuration options"),
  );
  expect(loadModel).not.toHaveBeenCalled();
});
