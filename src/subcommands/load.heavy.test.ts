import path from "path";
import { runCommandSync } from "../util.js";

describe("load", () => {
  const cliPath = path.join(__dirname, "../../../../publish/cli/dist/index.js");

  describe("load command", () => {
    it("should show help when --help flag is used", () => {
      const { status, stdout } = runCommandSync("node", [
        cliPath,
        "load",
        "--help",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(1);
      expect(stdout).toContain("Load a model");
    });

    it("should load model without identifier and verify with ps", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("Load stderr:", stderr);
      expect(status).toBe(0);

      // Check if model is loaded using ps command and extract identifier
      const {
        status: psStatus,
        stdout: psOutput,
        stderr: psStderr,
      } = runCommandSync("node", [cliPath, "ps", "--host", "localhost", "--port", "1234"]);
      if (psStatus !== 0) console.error("PS stderr:", psStderr);
      expect(psStatus).toBe(0);
      expect(psOutput).toContain("gemma-3-1b");

      // Extract the model identifier from ps output
      const lines = psOutput.split("\n");
      const modelLine = lines.find(line => line.includes("gemma-3-1b"));
      expect(modelLine).toBeTruthy();

      // Parse identifier from the model line (assuming format like "identifier (path)")
      const identifierMatch = modelLine!.match(/Identifier:\s*([^\s(]+)/);
      expect(identifierMatch).toBeTruthy();
      const modelIdentifier = identifierMatch![1];

      // Unload the model using the extracted identifier
      const { status: unloadStatus, stderr: unloadStderr } = runCommandSync("node", [
        cliPath,
        "unload",
        modelIdentifier,
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (unloadStatus !== 0) console.error("Unload stderr:", unloadStderr);
      expect(unloadStatus).toBe(0);
    });

    it("should load model with basic flags and verify with ps", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--identifier",
        "basic-model",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("Load stderr:", stderr);
      expect(status).toBe(0);

      // Check if model is loaded using ps command
      const {
        status: psStatus,
        stdout: psOutput,
        stderr: psStderr,
      } = runCommandSync("node", [cliPath, "ps", "--host", "localhost", "--port", "1234"]);
      if (psStatus !== 0) console.error("PS stderr:", psStderr);
      expect(psStatus).toBe(0);
      expect(psOutput).toContain("basic-model");

      // Unload the model
      const { status: unloadStatus, stderr: unloadStderr } = runCommandSync("node", [
        cliPath,
        "unload",
        "basic-model",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (unloadStatus !== 0) console.error("Unload stderr:", unloadStderr);
      expect(unloadStatus).toBe(0);
    });

    it("should handle advanced flags (GPU, TTL, context-length)", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--identifier",
        "advanced-model",
        "--ttl",
        "1800",
        "--gpu",
        "0.8",
        "--context-length",
        "4096",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("Load stderr:", stderr);
      expect(status).toBe(0);

      // Cleanup
      runCommandSync("node", [
        cliPath,
        "unload",
        "advanced-model",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
    });

    it("should handle GPU options (off, max, numeric)", () => {
      // Test GPU off
      const { status: status1, stderr: stderr1 } = runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--identifier",
        "gpu-off-model",
        "--gpu",
        "off",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status1 !== 0) console.error("Load stderr:", stderr1);
      expect(status1).toBe(0);
      runCommandSync("node", [
        cliPath,
        "unload",
        "gpu-off-model",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);

      // Test GPU max
      const { status: status2, stderr: stderr2 } = runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--identifier",
        "gpu-max-model",
        "--gpu",
        "max",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status2 !== 0) console.error("Load stderr:", stderr2);
      expect(status2).toBe(0);
      runCommandSync("node", [
        cliPath,
        "unload",
        "gpu-max-model",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
    });

    it("should handle custom identifier and verify in ps", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "load",
        "gemma-3-1b",
        "--identifier",
        "custom-gemma",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("Load stderr:", stderr);
      expect(status).toBe(0);

      // Check if model is loaded with custom identifier
      const {
        status: psStatus,
        stdout: psOutput,
        stderr: psStderr,
      } = runCommandSync("node", [cliPath, "ps", "--host", "localhost", "--port", "1234"]);
      if (psStatus !== 0) console.error("PS stderr:", psStderr);
      expect(psStatus).toBe(0);
      expect(psOutput).toContain("custom-gemma");

      // Unload by identifier
      const { status: unloadStatus, stderr: unloadStderr } = runCommandSync("node", [
        cliPath,
        "unload",
        "custom-gemma",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (unloadStatus !== 0) console.error("Unload stderr:", unloadStderr);
      expect(unloadStatus).toBe(0);
    });

    it("should handle error cases gracefully", () => {
      // Non-existent model with exact flag
      const { status: status1, stderr: stderr1 } = runCommandSync("node", [
        cliPath,
        "load",
        "non-existent-model",
        "--exact",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status1).not.toBe(0);
      expect(stderr1).toBeTruthy();

      // Non-existent model with yes flag
      const { status: status2, stderr: stderr2 } = runCommandSync("node", [
        cliPath,
        "load",
        "non-existent-model",
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status2).not.toBe(0);
      expect(stderr2).toBeTruthy();

      // Exact flag without path
      const { status: status3, stderr: stderr3 } = runCommandSync("node", [
        cliPath,
        "load",
        "--exact",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status3).not.toBe(0);
      expect(stderr3).toBeTruthy();
    });

    it("should verify ls shows downloaded models", () => {
      const { status, stdout, stderr } = runCommandSync("node", [
        cliPath,
        "ls",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("LS stderr:", stderr);
      expect(status).toBe(0);
      expect(stdout).toContain("models");
    });
  });
});
