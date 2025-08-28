import path from "path";
import { CLI_PATH, runCommandSync, TEST_MODEL_EXPECTED } from "../util.js";

describe("load", () => {
  const cliPath = path.join(__dirname, CLI_PATH);

  // Helper function to check if model is loaded using ps command
  const verifyModelLoaded = (
    expectedIdentifier: string,
    expectedTtlMs: number | null = null,
    expectedContextLength: number | null = null,
  ) => {
    const { status, stdout, stderr } = runCommandSync("node", [
      cliPath,
      "ps",
      "--host",
      "localhost",
      "--port",
      "1234",
      "--json",
    ]);
    if (status !== 0) console.error("PS stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout).toContain(expectedIdentifier);

    const psData = JSON.parse(stdout);
    const model = psData.find(
      (m: any) => m.path !== undefined && m.path.includes(TEST_MODEL_EXPECTED),
    );
    expect(model).toBeTruthy();

    if (expectedTtlMs !== null) {
      expect(model.ttlMs).toBe(expectedTtlMs);
    }

    if (expectedContextLength !== null) {
      expect(model.contextLength).toBe(expectedContextLength);
    }

    return model.identifier;
  };

  const unloadAllModels = () => {
    const { status } = runCommandSync("node", [
      cliPath,
      "unload",
      "--all",
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);
    if (status !== 0) {
      console.error("Failed to unload all models during cleanup.");
    }
  };

  beforeAll(() => {
    // Ensure cleanup of any loaded models before tests
    unloadAllModels();
  });

  afterAll(() => {
    // Ensure cleanup of any loaded models after tests
    unloadAllModels();
  });

  describe("load command", () => {
    it("should load model without identifier and verify with ps", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "load",
        TEST_MODEL_EXPECTED,
        "--yes",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      if (status !== 0) console.error("Load stderr:", stderr);
      expect(status).toBe(0);

      // Verify model is loaded and get identifier
      const modelIdentifier = verifyModelLoaded(TEST_MODEL_EXPECTED);

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
        TEST_MODEL_EXPECTED,
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

      // Verify model is loaded
      verifyModelLoaded("basic-model");

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
        TEST_MODEL_EXPECTED,
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

      // Verify model is loaded with correct TTL and context length
      verifyModelLoaded("advanced-model", 1800000, 4096);

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
        TEST_MODEL_EXPECTED,
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
        TEST_MODEL_EXPECTED,
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
        TEST_MODEL_EXPECTED,
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

      // Verify model is loaded with custom identifier
      verifyModelLoaded("custom-gemma");

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
  });
});
