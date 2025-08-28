import path from "path";
import { CLI_PATH, runCommandSync } from "../util.js";

describe.skip("chat heavy", () => {
  const cliPath = path.join(__dirname, CLI_PATH);
  const modelIdentifier = "test-model";
  const modelToUse = "gemma-3-1b";

  beforeAll(async () => {
    // Ensure the test model is loaded
    const { status } = runCommandSync("node", [
      cliPath,
      "load",
      modelToUse,
      "--identifier",
      modelIdentifier,
      "--yes",
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);
    if (status !== 0) {
      throw new Error(`Failed to load test model: ${modelIdentifier}`);
    }
  }, 30000);

  afterAll(async () => {
    // Clean up by unloading the model
    const { status } = runCommandSync("node", [
      cliPath,
      "unload",
      modelIdentifier,
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);
    if (status !== 0) {
      console.warn(`Failed to unload test model: ${modelIdentifier}`);
    }
  }, 10000);

  it("should respond to simple prompt with specific model", () => {
    const { status, stdout, stderr } = runCommandSync("node", [
      cliPath,
      "chat",
      modelIdentifier,
      "--prompt",
      '"What is 2+2? Answer briefly:"',
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain("4");
  }, 15000);

  it("should use custom system prompt", () => {
    const { status, stdout, stderr } = runCommandSync("node", [
      cliPath,
      "chat",
      modelIdentifier,
      "--prompt",
      '"What is your role?"',
      "--system-prompt",
      '"You are a helpful assistant."',
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/(assistant|help)/);
  }, 15000);

  it("should display stats when --stats flag is used", () => {
    const { status, stderr } = runCommandSync("node", [
      cliPath,
      "chat",
      modelIdentifier,
      "--prompt",
      '"Hi"',
      "--stats",
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stderr).toContain("Prediction Stats:");
    expect(stderr).toContain("Stop Reason:");
    expect(stderr).toContain("Tokens/Second:");
  }, 15000);

  it("should work with default model when no model specified", () => {
    const { status, stdout, stderr } = runCommandSync("node", [
      cliPath,
      "chat",
      "--prompt",
      "\"Say hello. Respond with just 'hello'\"",
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain("hello");
  }, 15000);

  it("should fail gracefully with non-existent model", () => {
    const { status, stderr } = runCommandSync("node", [
      cliPath,
      "chat",
      "non-existent-model",
      "--prompt",
      '"test"',
      "--host",
      "localhost",
      "--port",
      "1234",
    ]);

    expect(status).not.toBe(0);
    expect(stderr).toContain("not found");
    expect(stderr).toContain("lms ls");
  });
});
