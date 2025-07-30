import path from "path";
import { runCommandSync } from "../util.js";

describe("chat heavy", () => {
  const cliPath = path.join(__dirname, "../../../../publish/cli/dist/index.js");
  const modelIdentifier = "test-model";
  const modelToUse = "gemma-3-1b";

  beforeAll(async () => {
    // Ensure the test model is loaded
    const { status } = runCommandSync(
      `node ${cliPath} load ${modelToUse} --identifier ${modelIdentifier} --yes --host localhost --port 1234`,
    );
    if (status !== 0) {
      throw new Error(`Failed to load test model: ${modelIdentifier}`);
    }
  }, 30000);

  afterAll(async () => {
    // Clean up by unloading the model
    const { status } = runCommandSync(
      `node ${cliPath} unload ${modelIdentifier} --host localhost --port 1234`,
    );
    if (status !== 0) {
      console.warn(`Failed to unload test model: ${modelIdentifier}`);
    }
  }, 10000);

  it("should respond to simple prompt with specific model", () => {
    const { status, stdout, stderr } = runCommandSync(
      `echo "What is 2+2?" | node ${cliPath} chat ${modelIdentifier} --prompt "Answer briefly:" --host localhost --port 1234`,
    );

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain("4");
  }, 15000);

  it("should respond to stdin input", () => {
    const { status, stdout, stderr } = runCommandSync(
      `echo "What color is the sky?" | node ${cliPath} chat ${modelIdentifier} --host localhost --port 1234`,
    );

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/(blue|sky)/);
  }, 15000);

  it("should use custom system prompt", () => {
    const { status, stdout, stderr } = runCommandSync(
      `echo "What is your role?" | node ${cliPath} chat ${modelIdentifier} --system-prompt "You are a helpful assistant." --host localhost --port 1234`,
    );

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/(assistant|help)/);
  }, 15000);

  it("should display stats when --stats flag is used", () => {
    const { status, stderr } = runCommandSync(
      `echo "Hi" | node ${cliPath} chat ${modelIdentifier} --stats --host localhost --port 1234`,
    );

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stderr).toContain("Prediction Stats:");
    expect(stderr).toContain("Stop Reason:");
    expect(stderr).toContain("Tokens/Second:");
  }, 15000);

  it("should combine prompt and stdin input", () => {
    const { status, stdout, stderr } = runCommandSync(
      `echo "The capital of France" | node ${cliPath} chat ${modelIdentifier} --prompt "Complete this sentence:" --host localhost --port 1234`,
    );

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain("paris");
  }, 15000);

  it("should work with default model when no model specified", () => {
    const { status, stdout, stderr } = runCommandSync(
      `echo "Say hello" | node ${cliPath} chat --prompt "Respond with just 'hello'" --host localhost --port 1234`,
    );

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain("hello");
  }, 15000);

  it("should handle mathematical questions", () => {
    const { status, stdout, stderr } = runCommandSync(
      `echo "What is 15 * 7?" | node ${cliPath} chat ${modelIdentifier} --host localhost --port 1234`,
    );

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout).toContain("105");
  }, 15000);

  it("should fail gracefully with non-existent model", () => {
    const { status, stderr } = runCommandSync(
      `echo "test" | node ${cliPath} chat non-existent-model --host localhost --port 1234`,
    );

    expect(status).not.toBe(0);
    expect(stderr).toContain("not found");
    expect(stderr).toContain("lms ls");
  });

  it("should handle empty input gracefully", () => {
    const { status, stdout, stderr } = runCommandSync(
      `echo "" | node ${cliPath} chat ${modelIdentifier} --prompt "Say OK" --host localhost --port 1234`,
    );

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toContain("ok");
  }, 15000);

  it("should respond to coding questions", () => {
    const { status, stdout, stderr } = runCommandSync(
      `echo "Write a simple hello world in Python" | node ${cliPath} chat ${modelIdentifier} --host localhost --port 1234`,
    );

    if (status !== 0) console.error("Chat stderr:", stderr);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/(print|hello|world|python)/);
  }, 20000);
});
