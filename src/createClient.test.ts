import { type SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";
import { createClient } from "./createClient.js";

jest.mock("@lmstudio/sdk", () => ({ LMStudioClient: jest.fn() }));

const logger = {
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as SimpleLogger;

describe("createClient", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([
    ["legacy", { package: "lmstudio", version: "1.2.3" }],
    ["unverified", { lmstudio: true }],
  ])("rejects a %s explicit server when Bionic is required", async (_name, status) => {
    jest.spyOn(global, "fetch").mockImplementation(async input => {
      const url = input.toString();
      if (url.endsWith("/lmstudio-greeting")) {
        return new Response(JSON.stringify({ lmstudio: true }), { status: 200 });
      }
      return new Response(JSON.stringify(status), { status: 200 });
    });
    jest.spyOn(process, "exit").mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(
      createClient(logger, { host: "server.example", port: 45678 }, { requireBionic: true }),
    ).rejects.toThrow("process.exit(1)");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://server.example:45678/lms-status",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(logger.error).toHaveBeenCalledWith("This option is only available when using Bionic.");
    expect(LMStudioClient).not.toHaveBeenCalled();
  });
});
