import { type SimpleLogger } from "@lmstudio/lms-common";
import { createClient } from "../createClient.js";
import type * as CreateClientModule from "../createClient.js";
import { createDeviceNameResolver } from "../deviceNameLookup.js";
import { createLogger } from "../logLevel.js";
import type * as LogLevelModule from "../logLevel.js";
import { unload } from "./unload.js";

jest.mock("@inquirer/prompts", () => ({ search: jest.fn() }));
jest.mock("../createClient.js", () => ({
  ...jest.requireActual<typeof CreateClientModule>("../createClient.js"),
  createClient: jest.fn(),
}));
jest.mock("../logLevel.js", () => ({
  ...jest.requireActual<typeof LogLevelModule>("../logLevel.js"),
  createLogger: jest.fn(),
}));
jest.mock("../deviceNameLookup.js", () => ({ createDeviceNameResolver: jest.fn() }));

function createModel(identifier: string) {
  return {
    identifier,
    path: `test/${identifier}`,
    getModelInfo: async () => ({ deviceIdentifier: null }),
    unload: jest.fn(async () => {}),
  };
}

const models = [createModel("llm"), createModel("embedding"), createModel("decision")];
const client = {
  [Symbol.asyncDispose]: async () => {},
  llm: { listLoaded: jest.fn(async () => [models[0]]) },
  embedding: { listLoaded: jest.fn(async () => [models[1]]) },
  decision: { listLoaded: jest.fn(async () => [models[2]]) },
};

beforeEach(() => {
  jest.clearAllMocks();
  unload.setOptionValue("all", false);
  jest
    .mocked(createClient)
    .mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  jest.mocked(createLogger).mockReturnValue({
    info: jest.fn(),
    debug: jest.fn(),
    errorWithoutPrefix: jest.fn(),
  } as unknown as SimpleLogger);
  jest.mocked(createDeviceNameResolver).mockResolvedValue({
    isLocal: (deviceIdentifier: string | null) => deviceIdentifier === null,
    label: () => "Test host",
  } as unknown as Awaited<ReturnType<typeof createDeviceNameResolver>>);
});

it.each([
  { args: ["--all"], unloaded: ["llm", "embedding", "decision"] },
  { args: ["decision"], unloaded: ["decision"] },
])("unloads $unloaded for arguments $args", async ({ args, unloaded }) => {
  await unload.parseAsync(["node", "lms", ...args]);
  for (const model of models) {
    expect(model.unload).toHaveBeenCalledTimes(
      unloaded.includes(model.identifier) === true ? 1 : 0,
    );
  }
});
