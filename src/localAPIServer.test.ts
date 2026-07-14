import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readLocalAPIServerPort } from "./localAPIServer.js";

let tempFolder: string;

beforeEach(() => {
  tempFolder = mkdtempSync(join(tmpdir(), "lms-api-server-"));
});

afterEach(() => {
  rmSync(tempFolder, { force: true, recursive: true });
});

describe("readLocalAPIServerPort", () => {
  test("reads a valid published port", () => {
    const infoFilePath = join(tempFolder, "http-server.json");
    writeFileSync(infoFilePath, JSON.stringify({ host: "127.0.0.1", pid: 123, port: 45678 }));

    expect(readLocalAPIServerPort(infoFilePath)).toBe(45678);
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
});
