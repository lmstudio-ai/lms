import path from "path";
import { runCommandSync } from "../util.js";

describe("flags", () => {
  const cliPath = path.join(__dirname, "../../../../publish/cli/dist/index.js");

  it("should show help when --help flag is used", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags --help`);
    expect(status).toBe(1);
    expect(stdout).toContain("Set or get experiment flags");
  });

  it("should list all flags when no arguments provided", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags`);
    expect(status).toBe(0);
    // Should either show flags or "No experiment flags are set"
    expect(stdout).toMatch(/(Enabled experiment flags:|No experiment flags are set)/);
  });

  it("should output JSON when --json flag is used with no arguments", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags --json`);
    expect(status).toBe(0);
    expect(() => JSON.parse(stdout.trim())).not.toThrow();
  });

  it("should check specific flag status", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags test-flag`);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Flag "test-flag" is currently (enabled|disabled)/);
  });

  it("should output JSON when checking specific flag with --json", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags test-flag --json`);
    expect(status).toBe(0);
    const result = JSON.parse(stdout.trim());
    expect(typeof result).toBe("boolean");
  });

  it("should set flag to true", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags test-flag true`);
    expect(status).toBe(0);
    expect(stdout).toContain('Set flag "test-flag" to true');
  });

  it("should set flag to false", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags test-flag false`);
    expect(status).toBe(0);
    expect(stdout).toContain('Set flag "test-flag" to false');
  });

  it("should output JSON when setting flag with --json", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags test-flag true --json`);
    expect(status).toBe(0);
    const result = JSON.parse(stdout.trim());
    expect(result).toEqual({ flag: "test-flag", value: true });
  });

  it("should reject invalid boolean values", () => {
    const { status, stderr } = runCommandSync(`node ${cliPath} flags test-flag invalid`);
    expect(status).not.toBe(0);
    expect(stderr).toContain("Expected 'true' or 'false'");
  });

  it("should accept case-insensitive boolean values", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags test-flag TRUE`);
    expect(status).toBe(0);
    expect(stdout).toContain('Set flag "test-flag" to true');

    const { status: status2, stdout: stdout2 } = runCommandSync(
      `node ${cliPath} flags test-flag FALSE`,
    );
    expect(status2).toBe(0);
    expect(stdout2).toContain('Set flag "test-flag" to false');
  });

  it("should handle whitespace in boolean values", () => {
    const { status, stdout } = runCommandSync(`node ${cliPath} flags test-flag " true "`);
    expect(status).toBe(0);
    expect(stdout).toContain('Set flag "test-flag" to true');
  });
});
