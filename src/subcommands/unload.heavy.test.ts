import path from "path";
import { TEST_CLI_PATH, testRunCommandSync, TEST_MODEL_EXPECTED } from "../util.test.js";

describe("unload", () => {
  const cliPath = path.join(__dirname, TEST_CLI_PATH);

  // Helper function to load a model
  const loadModel = (identifier: string) => {
    const { status, stderr } = testRunCommandSync("node", [
      cliPath,
      "load",
      TEST_MODEL_EXPECTED,
      "--identifier",
      identifier,
      "--yes",
    ]);
    if (status !== 0) console.error("Load stderr:", stderr);
    expect(status).toBe(0);
  };

  // Helper function to verify model is loaded
  const verifyModelLoaded = (identifier: string) => {
    const { status, stdout } = testRunCommandSync("node", [cliPath, "ps"]);
    expect(status).toBe(0);
    expect(stdout).toContain(identifier);
  };

  // Helper function to verify model is not loaded
  const verifyModelNotLoaded = (identifier: string) => {
    const { status, stdout } = testRunCommandSync("node", [cliPath, "ps"]);
    expect(status).toBe(0);
    expect(stdout).not.toContain(identifier);
  };

  // Helper function to unload model by identifier
  const unloadModel = (identifier: string) => {
    const { status, stderr } = testRunCommandSync("node", [cliPath, "unload", identifier]);
    if (status !== 0) console.error("Unload stderr:", stderr);
    expect(status).toBe(0);
  };

  // Helper function to unload all models
  const unloadAllModels = () => {
    const { status, stderr } = testRunCommandSync("node", [cliPath, "unload", "--all"]);
    if (status !== 0) console.error("Unload --all stderr:", stderr);
    expect(status).toBe(0);
  };

  beforeAll(() => {
    // Have a clean state where all models are unloaded before tests
    unloadAllModels();
  });
  afterAll(() => {
    // Cleanup: Ensure all models are unloaded after tests
    unloadAllModels();
  });
  describe("unload command", () => {
    it("should handle unload with specific identifier", () => {
      // Load model and verify
      loadModel("test-unload-model");
      loadModel("last-model-to-unload");
      verifyModelLoaded("test-unload-model");
      verifyModelLoaded("last-model-to-unload");

      // Unload the specific model
      unloadModel("test-unload-model");

      // Verify it's no longer loaded
      verifyModelNotLoaded("test-unload-model");
      verifyModelLoaded("last-model-to-unload");

      // Cleanup
      unloadModel("last-model-to-unload");
      verifyModelNotLoaded("last-model-to-unload");
    });

    it("should handle unload --all flag", () => {
      // Load multiple models
      loadModel("model-1");
      loadModel("model-2");

      // Verify both are loaded
      verifyModelLoaded("model-1");
      verifyModelLoaded("model-2");

      // Unload all models
      unloadAllModels();

      // Verify no models are loaded
      verifyModelNotLoaded("model-1");
      verifyModelNotLoaded("model-2");
    });

    it("should handle unload --all with short flag", () => {
      // Load a model
      loadModel("short-flag-test");

      // Unload all with short flag
      const { status, stderr } = testRunCommandSync("node", [cliPath, "unload", "-a"]);
      if (status !== 0) console.error("Unload -a stderr:", stderr);
      expect(status).toBe(0);
    });

    it("should fail gracefully with non-existent model identifier", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "unload",
        "non-existent-model",
      ]);
      expect(status).not.toBe(0);
      expect(stderr).toBeTruthy();
      expect(stderr).toContain("Cannot find a model");
    });

    it("should fail when both identifier and --all flag are provided", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "unload",
        "some-model",
        "--all",
      ]);
      expect(status).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    it("should handle unload when no models are loaded", () => {
      // Make sure no models are loaded
      unloadAllModels();

      // Try to unload all when nothing is loaded
      unloadAllModels(); // Should succeed but show "No models to unload"
    });
  });
});
