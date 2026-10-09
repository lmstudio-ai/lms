import { findOrStartLocalAPIServer, tryFindLocalAPIServer } from "../../localAPIServer.js";
import { up } from "./up.js";

jest.mock("../../localAPIServer.js", () => ({
  tryFindLocalAPIServer: jest.fn(),
  findOrStartLocalAPIServer: jest.fn(),
}));
jest.mock("../../createClient.js", () => ({
  createClient: async () => ({
    system: { getInfo: async () => ({ pid: 123, isDaemon: false, version: "1.0.0" }) },
    async [Symbol.asyncDispose]() {},
  }),
}));

afterEach(() => jest.restoreAllMocks());

// Exercise both command paths so the selected app's identity survives startup.
test.each([true, false])("daemon up names Bionic when already running=%s", async running => {
  const server = { package: "bionic" as const, port: 1234, version: "1.0.0", internalFolder: "" };
  jest.mocked(tryFindLocalAPIServer).mockResolvedValue(running ? server : null);
  jest.mocked(findOrStartLocalAPIServer).mockResolvedValue(server);
  const output = jest.spyOn(console, "info").mockImplementation(() => {});
  await up.parseAsync([], { from: "user" });
  expect(output).toHaveBeenCalledWith(
    running
      ? "Bionic is already running (PID: 123); not starting a second daemon."
      : "Bionic started (PID: 123).",
  );
});
