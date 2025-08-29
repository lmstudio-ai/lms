import path from "path";
import { TEST_CLI_PATH, testRunCommandSync } from "../util.test.js";

// We skip chat tests to because we don't have max_tokens here.
describe.skip("chat heavy", () => {
  const cliPath = path.join(__dirname, TEST_CLI_PATH);
  const modelIdentifier = "test-model";
  const modelToUse = "gemma-3-1b";

  beforeAll(async () => {
    // Ensure the test model is loaded
    const { status } = testRunCommandSync("node", [
      cliPath,
      "load",
      modelToUse,
      "--identifier",
      modelIdentifier,
      "--yes",
    ]);
    if (status !== 0) {
      throw new Error(`Failed to load test model: ${modelIdentifier}`);
    }
  }, 30000);

  afterAll(async () => {
    // Clean up by unloading the model
    const { status } = testRunCommandSync("node", [cliPath, "unload", modelIdentifier]);
    if (status !== 0) {
      console.warn(`Failed to unload test model: ${modelIdentifier}`);
    }
  }, 10000);

  it("should respond to simple prompt with specific model", () => {
    const { status, stdout, stderr } = testRunCommandSync("node", [
      cliPath,
      "chat",
      modelIdentifier,
      "--prompt",
      '"What is 2+2? Answer briefly:"',
    ]);

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain("4");
  }, 15000);

  it("should use custom system prompt", () => {
    const { status, stdout, stderr } = testRunCommandSync("node", [
      cliPath,
      "chat",
      modelIdentifier,
      "--prompt",
      '"What is your role?"',
      "--system-prompt",
      '"You are a helpful assistant."',
    ]);

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/(assistant|help)/);
  }, 15000);

  it("should display stats when --stats flag is used", () => {
    const { status, stderr } = testRunCommandSync("node", [
      cliPath,
      "chat",
      modelIdentifier,
      "--prompt",
      '"Hi"',
      "--stats",
    ]);

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stderr).toContain("Prediction Stats:");
    expect(stderr).toContain("Stop Reason:");
    expect(stderr).toContain("Tokens/Second:");
  }, 15000);

  it("should work with default model when no model specified", () => {
    const { status, stdout, stderr } = testRunCommandSync("node", [
      cliPath,
      "chat",
      "--prompt",
      "\"Say hello. Respond with just 'hello'\"",
    ]);

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain("hello");
  }, 15000);

  it("should fail gracefully with non-existent model", () => {
    const { status, stderr } = testRunCommandSync("node", [
      cliPath,
      "chat",
      "non-existent-model",
      "--prompt",
      '"test"',
    ]);

    expect(status).not.toBe(0);
    expect(stderr).toContain("not found");
    expect(stderr).toContain("lms ls");
  });
});
