import path from "path";
import { CLI_PATH, runCommandSync } from "../util.js";

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
      const { status } = runCommandSync("node", [
        cliPath,
        "ls",
        "--llm",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
    });

    it("should filter embedding models only", () => {
      const { status } = runCommandSync("node", [
        cliPath,
        "ls",
        "--embedding",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
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
    it("should show loaded models", () => {
      const { status } = runCommandSync("node", [
        cliPath,
        "ps",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
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
      }
    });

    it("should handle no loaded models gracefully", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "ps",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
      // Command might show "No models are currently loaded" but should not fail
    });
  });
});
