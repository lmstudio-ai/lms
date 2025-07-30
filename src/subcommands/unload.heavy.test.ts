import path from "path";
import { runCommandSync } from "../util.js";

describe("unload", () => {
  const cliPath = path.join(__dirname, "../../../../publish/cli/dist/index.js");

  describe("unload command", () => {
    it("should show help when --help flag is used", () => {
      const { status, stdout } = runCommandSync("node", [
        cliPath,
        "unload",
        "--help",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(1);
      expect(stdout).toContain("Unload a model");
    });

    it("should handle unload with specific identifier", () => {
      // First load a model with identifier
      const { status: loadStatus, stderr: loadStderr } = runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--identifier",
        "test-unload-model",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (loadStatus !== 0) console.error("Load stderr:", loadStderr);
      expect(loadStatus).toBe(0);

      // Verify it's loaded
      const { status: psStatus, stdout: psOutput } = runCommandSync("node", [
        cliPath,
        "ps",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(psStatus).toBe(0);
      expect(psOutput).toContain("test-unload-model");

      // Unload the specific model
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "unload",
        "test-unload-model",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("Unload stderr:", stderr);
      expect(status).toBe(0);

      // Verify it's no longer loaded
      const { status: psStatus2, stdout: psOutput2 } = runCommandSync("node", [
        cliPath,
        "ps",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(psStatus2).toBe(0);
      expect(psOutput2).not.toContain("test-unload-model");
    });

    it("should handle unload --all flag", () => {
      // Load multiple models
      runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--identifier",
        "model-1",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--identifier",
        "model-2",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);

      // Verify both are loaded
      const { status: psStatus1, stdout: psOutput1 } = runCommandSync("node", [
        cliPath,
        "ps",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(psStatus1).toBe(0);
      expect(psOutput1).toContain("model-1");
      expect(psOutput1).toContain("model-2");

      // Unload all models
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "unload",
        "--all",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("Unload --all stderr:", stderr);
      expect(status).toBe(0);

      // Verify no models are loaded
      const { status: psStatus2, stdout: psOutput2 } = runCommandSync("node", [
        cliPath,
        "ps",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(psStatus2).toBe(0);
      expect(psOutput2).not.toContain("model-1");
      expect(psOutput2).not.toContain("model-2");
    });

    it("should handle unload --all with short flag", () => {
      // Load a model
      runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--identifier",
        "short-flag-test",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);

      // Unload all with short flag
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "unload",
        "-a",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("Unload -a stderr:", stderr);
      expect(status).toBe(0);
    });

    it("should fail gracefully with non-existent model identifier", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "unload",
        "non-existent-model",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).not.toBe(0);
      expect(stderr).toBeTruthy();
      expect(stderr).toContain("Cannot find a model");
    });

    it("should fail when both identifier and --all flag are provided", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "unload",
        "some-model",
        "--all",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    it("should handle unload when no models are loaded", () => {
      // Make sure no models are loaded
      runCommandSync("node", [cliPath, "unload", "--all", "--host", "localhost", "--port", "1234"]);

      // Try to unload all when nothing is loaded
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "unload",
        "--all",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("Unload stderr:", stderr);
      expect(status).toBe(0); // Should succeed but show "No models to unload"
    });
  });
});
