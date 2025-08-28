import path from "path";
import { CLI_PATH, runCommandSync } from "../util.js";

describe("status", () => {
  const cliPath = path.join(__dirname, CLI_PATH);

  beforeAll(() => {
    // Start the server regardless of its current state
    const { status } = runCommandSync("node", [cliPath, "server", "start", "--port", "1234"]);
    if (status !== 0) {
      throw new Error("Failed to start the server before tests.");
    }
  });

  afterAll(() => {
    // Make sure server is up even after the tests
    const { status } = runCommandSync("node", [cliPath, "server", "start", "--port", "1234"]);
    if (status !== 0) {
      console.error("Failed to start the server after tests.");
    }
  });

  describe("status command", () => {
    it("should show LM Studio status", () => {
      const { status } = runCommandSync("node", [
        cliPath,
        "status",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
    });
  });

  it("update status when server state is updated", () => {
    const { status, stdout } = runCommandSync("node", [
      cliPath,
      "status",
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("ON");

    const { status: statusForSwitch } = runCommandSync("node", [cliPath, "server", "stop"]);
    expect(statusForSwitch).toBe(0);

    const { status: statusAfterStop, stdout: stdoutAfterStop } = runCommandSync("node", [
      cliPath,
      "status",
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);
    expect(statusAfterStop).toBe(0);
    expect(stdoutAfterStop).toContain("OFF");
  });
});
