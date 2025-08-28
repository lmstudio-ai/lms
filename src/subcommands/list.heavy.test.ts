import path from "path";
import { CLI_PATH, runCommandSync, TEST_MODEL_EXPECTED } from "../util.js";

describe("list", () => {
  const cliPath = path.join(__dirname, CLI_PATH);

  describe("ls command", () => {
    it("should show downloaded models", () => {
      const { status, stdout } = runCommandSync("node", [
        cliPath,
        "ls",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
      expect(stdout).toContain("models");
    });

    it("should filter LLM models only", () => {
      const { status, stdout } = runCommandSync("node", [
        cliPath,
        "ls",
        "--llm",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
      expect(stdout).toContain("LLM");
      expect(stdout).toContain("PARAMS");
      expect(stdout).toContain(TEST_MODEL_EXPECTED);
    });

    it("should filter embedding models only", () => {
      const { status, stdout } = runCommandSync("node", [
        cliPath,
        "ls",
        "--embedding",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
      expect(stdout).toContain("EMBEDDING");
      expect(stdout).toContain("PARAMS");
    });

    it("should output JSON format", () => {
      const { status, stdout } = runCommandSync("node", [
        cliPath,
        "ls",
        "--json",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
      if (stdout.trim()) {
        expect(() => JSON.parse(stdout)).not.toThrow();
        expect(stdout).toContain(TEST_MODEL_EXPECTED);
      }
    });

    it("should handle combined flags with json", () => {
      const { status, stdout } = runCommandSync("node", [
        cliPath,
        "ls",
        "--embedding",
        "--json",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
      if (stdout.trim()) {
        expect(() => JSON.parse(stdout)).not.toThrow();
      }
    });
  });

  describe("ps command", () => {
    beforeAll(() => {
      // Ensure the server is running before tests
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "load",
        TEST_MODEL_EXPECTED,
        "--identifier",
        TEST_MODEL_EXPECTED,
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) {
        console.error("Server stderr:", stderr);
      }
      expect(status).toBe(0);
    });

    afterAll(() => {
      // Cleanup: Unload the model after tests
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "unload",
        TEST_MODEL_EXPECTED,
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) {
        console.error("Unload stderr:", stderr);
      }
      expect(status).toBe(0);
    });

    it("should show loaded models", () => {
      const { status, stdout } = runCommandSync("node", [
        cliPath,
        "ps",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
      expect(stdout).toContain(TEST_MODEL_EXPECTED);
    });

    it("should output JSON format", () => {
      const { status, stdout } = runCommandSync("node", [
        cliPath,
        "ps",
        "--json",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
      if (stdout.trim()) {
        expect(() => JSON.parse(stdout)).not.toThrow();
        expect(
          JSON.parse(stdout).some((model: any) => model.identifier === TEST_MODEL_EXPECTED),
        ).toBe(true);
      }
    });

    it("should handle no loaded models gracefully", () => {
      const { status } = runCommandSync("node", [
        cliPath,
        "ps",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      // Command might show "No models are currently loaded" but should not fail
      expect(status).toBe(0);
    });
  });
});
