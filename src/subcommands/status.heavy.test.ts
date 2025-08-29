import path from "path";
import { TEST_CLI_PATH, testRunCommandSync } from "../test-utils.js";

// Skipping tests because non-privileged mode.
describe.skip("status", () => {
  const cliPath = path.join(__dirname, TEST_CLI_PATH);

  beforeAll(() => {
    // Start the server regardless of its current state
    const { status } = testRunCommandSync("node", [cliPath, "server", "start", "--port", "1234"]);
    if (status !== 0) {
      throw new Error("Failed to start the server before tests.");
    }
  });

  afterAll(() => {
    // Make sure server is up even after the tests
    const { status } = testRunCommandSync("node", [cliPath, "server", "start", "--port", "1234"]);
    if (status !== 0) {
      console.error("Failed to start the server after tests.");
    }
  });

  describe("status command", () => {
    it("should show LM Studio status", () => {
      const { status } = testRunCommandSync("node", [cliPath, "status"]);
      expect(status).toBe(0);
    });
  });

  it("update status when server state is updated", () => {
    const { status, stdout } = testRunCommandSync("node", [cliPath, "status"]);
    expect(status).toBe(0);
    expect(stdout).toContain("ON");

    const { status: statusForSwitch } = testRunCommandSync("node", [cliPath, "server", "stop"]);
    expect(statusForSwitch).toBe(0);

    const { status: statusAfterStop, stdout: stdoutAfterStop } = testRunCommandSync("node", [
      cliPath,
      "status",
    ]);
    expect(statusAfterStop).toBe(0);
    expect(stdoutAfterStop).toContain("OFF");
  });
});
