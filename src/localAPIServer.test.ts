import { type LoggerInterface } from "@lmstudio/lms-common";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readLocalAPIServerPort, tryFindLocalAPIServer } from "./localAPIServer.js";

const originalAPIInfoPath = process.env.LMS_API_SERVER_INFO_PATH;
const logger: LoggerInterface = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};
let tempFolder: string;

beforeEach(() => {
  tempFolder = mkdtempSync(join(tmpdir(), "lms-api-server-"));
});

afterEach(() => {
  if (originalAPIInfoPath === undefined) {
    delete process.env.LMS_API_SERVER_INFO_PATH;
  } else {
    process.env.LMS_API_SERVER_INFO_PATH = originalAPIInfoPath;
  }
  jest.restoreAllMocks();
  rmSync(tempFolder, { force: true, recursive: true });
});

describe("readLocalAPIServerPort", () => {
  test("reads a valid published port", () => {
    const infoFilePath = join(tempFolder, "http-server.json");
    writeFileSync(infoFilePath, JSON.stringify({ host: "127.0.0.1", pid: 123, port: 45678 }));

    expect(readLocalAPIServerPort(infoFilePath)).toBe(45678);
  });

  test("uses the environment override when no path is passed", () => {
    const infoFilePath = join(tempFolder, "http-server.json");
    writeFileSync(infoFilePath, JSON.stringify({ port: 45678 }));
    process.env.LMS_API_SERVER_INFO_PATH = infoFilePath;

    expect(readLocalAPIServerPort()).toBe(45678);
  });

  test.each([
    ["a missing file", undefined],
    ["invalid JSON", "{"],
    ["a missing port", JSON.stringify({ pid: 123 })],
    ["port zero", JSON.stringify({ port: 0 })],
    ["a non-integer port", JSON.stringify({ port: 1234.5 })],
    ["a port above 65535", JSON.stringify({ port: 65536 })],
  ])("ignores %s", (_description, content) => {
    const infoFilePath = join(tempFolder, "http-server.json");
    if (content !== undefined) {
      writeFileSync(infoFilePath, content);
    }

    expect(readLocalAPIServerPort(infoFilePath)).toBeNull();
  });

  test("does not scan other ports when the environment override is stale", async () => {
    const infoFilePath = join(tempFolder, "http-server.json");
    writeFileSync(infoFilePath, JSON.stringify({ port: 45678 }));
    process.env.LMS_API_SERVER_INFO_PATH = infoFilePath;
    const fetchMock = jest.spyOn(global, "fetch").mockRejectedValue(new Error("Not listening"));

    await expect(tryFindLocalAPIServer(logger)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:45678/lms-status",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
