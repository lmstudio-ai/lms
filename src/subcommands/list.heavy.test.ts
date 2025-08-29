import path from "path";
import { TEST_CLI_PATH, testRunCommandSync, TEST_MODEL_EXPECTED } from "../test-utils.js";

describe("list", () => {
  const cliPath = path.join(__dirname, TEST_CLI_PATH);

  describe("ls command", () => {
    it("should show downloaded models", () => {
      const { status, stdout } = testRunCommandSync("node", [cliPath, "ls"]);
      expect(status).toBe(0);
      expect(stdout).toContain("models");
    });

    it("should filter LLM models only", () => {
      const { status, stdout } = testRunCommandSync("node", [cliPath, "ls", "--llm"]);
      expect(status).toBe(0);
      expect(stdout).toContain("LLM");
      expect(stdout).not.toContain("EMBEDDING");
      expect(stdout).toContain("PARAMS");
      expect(stdout).toContain(TEST_MODEL_EXPECTED);
    });

    it("should filter embedding models only", () => {
      const { status, stdout } = testRunCommandSync("node", [cliPath, "ls", "--embedding"]);
      expect(status).toBe(0);
      expect(stdout).toContain("EMBEDDING");
      expect(stdout).not.toContain("LLM");
      expect(stdout).toContain("PARAMS");
    });

    it("should output JSON format", () => {
      const { status, stdout } = testRunCommandSync("node", [cliPath, "ls", "--json"]);
      expect(status).toBe(0);
      if (stdout.trim()) {
        expect(() => JSON.parse(stdout)).not.toThrow();
        expect(stdout).toContain(TEST_MODEL_EXPECTED);
      }
    });

    it("should handle combined flags with json", () => {
      const { status, stdout } = testRunCommandSync("node", [
        cliPath,
        "ls",
        "--embedding",
        "--json",
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
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "load",
        TEST_MODEL_EXPECTED,
        "--identifier",
        TEST_MODEL_EXPECTED,
        "--yes",
      ]);
      if (status !== 0) {
        console.error("Server stderr:", stderr);
      }
      expect(status).toBe(0);
    });

    afterAll(() => {
      // Cleanup: Unload the model after tests
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "unload",
        TEST_MODEL_EXPECTED,
      ]);
      if (status !== 0) {
        console.error("Unload stderr:", stderr);
      }
      expect(status).toBe(0);
    });

    it("should show loaded models", () => {
      const { status, stdout } = testRunCommandSync("node", [cliPath, "ps"]);
      expect(status).toBe(0);
      expect(stdout).toContain(TEST_MODEL_EXPECTED);
    });

    it("should output JSON format", () => {
      const { status, stdout } = testRunCommandSync("node", [cliPath, "ps", "--json"]);
      expect(status).toBe(0);
      if (stdout.trim()) {
        expect(() => JSON.parse(stdout)).not.toThrow();
        expect(
          JSON.parse(stdout).some((model: any) => model.identifier === TEST_MODEL_EXPECTED),
        ).toBe(true);
      }
    });

    it("should handle no loaded models gracefully", () => {
      const { status } = testRunCommandSync("node", [cliPath, "ps"]);
      // Command might show "No models are currently loaded" but should not fail
      expect(status).toBe(0);
    });
  });
});
