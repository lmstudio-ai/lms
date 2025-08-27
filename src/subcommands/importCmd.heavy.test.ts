import path from "path";
import fs from "fs";
import { CLI_PATH, runCommandSync } from "../util.js";

describe("import dry run", () => {
  const cliPath = path.join(__dirname, CLI_PATH);
  const testModelPath = path.join(__dirname, "../../../test-fixtures/test-model.gguf");

  beforeAll(() => {
    // Create a test model file
    const testDir = path.dirname(testModelPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (!fs.existsSync(testModelPath)) {
      fs.writeFileSync(testModelPath, "fake model content");
    }
  });

  afterAll(() => {
    // Clean up test file
    if (fs.existsSync(testModelPath)) {
      fs.unlinkSync(testModelPath);
    }
  });

  it("should perform dry run without actually importing", () => {
    const { status, stderr } = runCommandSync("node", [
      cliPath,
      "import",
      testModelPath,
      "--dry-run",
      "--yes",
      "--user-repo",
      "test/model",
    ]);

    if (status !== 0) console.error("Import dry run stderr:", stderr);
    expect(status).toBe(0);
    expect(stderr).toContain("Would move");
    expect(stderr).toContain("--dry-run");
  });

  it("should show what would be done with copy flag", () => {
    const { status, stderr } = runCommandSync("node", [
      cliPath,
      "import",
      testModelPath,
      "--dry-run",
      "--copy",
      "--yes",
      "--user-repo",
      "test/model",
    ]);

    expect(status).toBe(0);
    expect(stderr).toContain("Would copy");
  });

  it("should show what would be done with hard link flag", () => {
    const { status, stderr } = runCommandSync("node", [
      cliPath,
      "import",
      testModelPath,
      "--dry-run",
      "--hard-link",
      "--yes",
      "--user-repo",
      "test/model",
    ]);

    expect(status).toBe(0);
    expect(stderr).toContain("Would create a hard link");
  });

  it("should show what would be done with symbolic link flag", () => {
    const { status, stderr } = runCommandSync("node", [
      cliPath,
      "import",
      testModelPath,
      "--dry-run",
      "--symbolic-link",
      "--yes",
      "--user-repo",
      "test/model",
    ]);

    expect(status).toBe(0);
    expect(stderr).toContain("Would create a symbolic link");
  });

  it("should fail when multiple operation flags are specified", () => {
    const { status, stderr } = runCommandSync("node", [
      cliPath,
      "import",
      testModelPath,
      "--dry-run",
      "--copy",
      "--hard-link",
      "--yes",
    ]);

    expect(status).not.toBe(0);
    expect(stderr).toContain("Cannot specify");
  });

  it("should handle non-existent file gracefully", () => {
    const { status, stderr } = runCommandSync("node", [
      cliPath,
      "import",
      "/non/existent/file.gguf",
      "--dry-run",
      "--yes",
      "--user-repo",
      "test/model",
    ]);

    expect(status).not.toBe(0);
    expect(stderr).toContain("File does not exist");
  });
});
