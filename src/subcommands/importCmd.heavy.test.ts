import path from "path";
import fs from "fs";
import os from "os";
import { TEST_CLI_PATH, testRunCommandSync } from "../test-utils.js";

// Helper function to create a minimal valid GGUF file
function createValidGGUFFile(filePath: string) {
  const buffer = Buffer.alloc(64);
  // GGUF magic number (4 bytes): "GGUF"
  buffer.write("GGUF", 0, "ascii");
  // Version (4 bytes): version 3
  buffer.writeUInt32LE(3, 4);
  // Tensor count (8 bytes): 0 tensors
  buffer.writeBigUInt64LE(0n, 8);
  // Metadata kv count (8 bytes): 0 metadata
  buffer.writeBigUInt64LE(0n, 16);
  fs.writeFileSync(filePath, buffer);
}

describe("import command", () => {
  const cliPath = path.join(__dirname, TEST_CLI_PATH);
  const testModelPath = path.join(__dirname, "../../../test-fixtures/test-model.gguf");
  const lmstudioModelsPath = path.join(os.homedir(), ".lmstudio", "models");

  beforeAll(() => {
    // Create a test model file
    const testDir = path.dirname(testModelPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (!fs.existsSync(testModelPath)) {
      createValidGGUFFile(testModelPath);
    }
  });

  afterAll(() => {
    // Clean up test model file
    if (fs.existsSync(testModelPath)) {
      fs.unlinkSync(testModelPath);
    }
  });

  describe("dry run tests", () => {
    let testFilePath: string;
    let testId: string;

    beforeEach(() => {
      // Create unique test file for each test
      testId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      testFilePath = path.join(os.tmpdir(), `${testId}.gguf`);
      createValidGGUFFile(testFilePath);
    });

    afterEach(() => {
      // Clean up test file
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }

      // Clean up any potential target files in LM Studio directory
      const targetDir = path.join(lmstudioModelsPath, "test", "model");
      const targetPath = path.join(targetDir, path.basename(testFilePath));
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    });

    it("should perform dry run without actually moving file", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--dry-run",
        "--yes",
        "--user-repo",
        "test/model",
      ]);

      expect(status).toBe(0);
      expect(stderr).toContain("Would move");
      expect(stderr).toContain("--dry-run");

      // Assert file was NOT moved
      expect(fs.existsSync(testFilePath)).toBe(true);
      expect(fs.existsSync(testFilePath)).toBe(true);
    });

    it("should perform dry run without actually copying file", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--dry-run",
        "--copy",
        "--yes",
        "--user-repo",
        "test/model",
      ]);

      expect(status).toBe(0);
      expect(stderr).toContain("Would copy");

      // Assert original file still exists and no target file was created
      expect(fs.existsSync(testFilePath)).toBe(true);
      const targetPath = path.join(
        lmstudioModelsPath,
        "test",
        "model",
        path.basename(testFilePath),
      );
      expect(fs.existsSync(targetPath)).toBe(false);
    });

    it("should perform dry run without actually creating hard link", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--dry-run",
        "--hard-link",
        "--yes",
        "--user-repo",
        "test/model",
      ]);

      expect(status).toBe(0);
      expect(stderr).toContain("Would create a hard link");

      // Assert original file still exists and no target file was created
      expect(fs.existsSync(testFilePath)).toBe(true);
      const targetPath = path.join(
        lmstudioModelsPath,
        "test",
        "model",
        path.basename(testFilePath),
      );
      expect(fs.existsSync(targetPath)).toBe(false);
    });

    it("should perform dry run without actually creating symbolic link", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--dry-run",
        "--symbolic-link",
        "--yes",
        "--user-repo",
        "test/model",
      ]);

      expect(status).toBe(0);
      expect(stderr).toContain("Would create a symbolic link");

      // Assert original file still exists and no target file was created
      expect(fs.existsSync(testFilePath)).toBe(true);
      const targetPath = path.join(
        lmstudioModelsPath,
        "test",
        "model",
        path.basename(testFilePath),
      );
      expect(fs.existsSync(targetPath)).toBe(false);
    });
  });

  // Skip for now as tests do not run inside the container.
  describe("actual import tests", () => {
    let testFilePath: string;
    let testId: string;
    let targetPath: string;

    beforeEach(() => {
      // Create unique test file for each test
      testId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      testFilePath = path.join(os.tmpdir(), `${testId}.gguf`);
      createValidGGUFFile(testFilePath);

      targetPath = path.join(lmstudioModelsPath, "test", "model", path.basename(testFilePath));
    });

    afterEach(() => {
      // Clean up test files
      [testFilePath, targetPath].forEach(filePath => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });

      // Clean up test directories if empty
      const targetDir = path.join(lmstudioModelsPath, "test", "model");
      const testUserDir = path.join(lmstudioModelsPath, "test");

      try {
        if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length === 0) {
          fs.rmdirSync(targetDir);
        }
        if (fs.existsSync(testUserDir) && fs.readdirSync(testUserDir).length === 0) {
          fs.rmdirSync(testUserDir);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    it("should actually move file when not in dry run mode", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--yes",
        "--user-repo",
        "test/model",
      ]);

      expect(status).toBe(0);
      expect(stderr).toContain("File moved to");

      // Assert file was moved
      expect(fs.existsSync(testFilePath)).toBe(false);
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
    });

    it("should actually copy file when using --copy flag", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--copy",
        "--yes",
        "--user-repo",
        "test/model",
      ]);

      expect(status).toBe(0);
      expect(stderr).toContain("File copied to");

      // Assert file was copied (both original and target exist)
      expect(fs.existsSync(testFilePath)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.existsSync(testFilePath)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
    });

    it("should actually create hard link when using --hard-link flag", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--hard-link",
        "--yes",
        "--user-repo",
        "test/model",
      ]);

      expect(status).toBe(0);
      expect(stderr).toContain("Hard link created at");

      // Assert hard link was created (both files exist and have same content)
      expect(fs.existsSync(testFilePath)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.existsSync(testFilePath)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);

      // Verify it's actually a hard link by checking inode numbers
      const originalStat = fs.statSync(testFilePath);
      const targetStat = fs.statSync(targetPath);
      expect(originalStat.ino).toBe(targetStat.ino);
    });

    it("should actually create symbolic link when using --symbolic-link flag", () => {
      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--symbolic-link",
        "--yes",
        "--user-repo",
        "test/model",
      ]);

      expect(status).toBe(0);
      expect(stderr).toContain("Symbolic link created at");

      // Assert symbolic link was created
      expect(fs.existsSync(testFilePath)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.existsSync(testFilePath)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);

      // Verify it's actually a symbolic link
      const targetStat = fs.lstatSync(targetPath);
      expect(targetStat.isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(targetPath)).toBe(testFilePath);
    });

    it("should create directory structure when importing", () => {
      const deepTargetPath = path.join(
        lmstudioModelsPath,
        "deep-user",
        "nested-repo",
        path.basename(testFilePath),
      );

      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--yes",
        "--user-repo",
        "deep-user/nested-repo",
      ]);

      expect(status).toBe(0);

      // Assert directory structure was created
      expect(fs.existsSync(path.join(lmstudioModelsPath, "deep-user", "nested-repo"))).toBe(true);
      expect(fs.existsSync(deepTargetPath)).toBe(true);

      // Clean up deep structure
      if (fs.existsSync(deepTargetPath)) {
        fs.unlinkSync(deepTargetPath);
      }
      ["nested-repo", "deep-user"].forEach(dir => {
        const dirPath = path.join(lmstudioModelsPath, dir);
        try {
          if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
            fs.rmdirSync(dirPath);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      });
    });
  });

  describe("error handling", () => {
    it("should fail when multiple operation flags are specified", () => {
      const { status, stderr } = testRunCommandSync("node", [
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
      const { status, stderr } = testRunCommandSync("node", [
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

    it("should fail when target file already exists", () => {
      const testId = `existing-test-${Date.now()}`;
      const testFilePath = path.join(os.tmpdir(), `${testId}.gguf`);
      createValidGGUFFile(testFilePath);

      const targetDir = path.join(lmstudioModelsPath, "test", "existing");
      const targetPath = path.join(targetDir, path.basename(testFilePath));

      // Create target directory and file
      fs.mkdirSync(targetDir, { recursive: true });
      createValidGGUFFile(targetPath);

      const { status, stderr } = testRunCommandSync("node", [
        cliPath,
        "import",
        testFilePath,
        "--yes",
        "--user-repo",
        "test/existing",
      ]);

      expect(status).not.toBe(0);
      expect(stderr).toContain("Target file already exists");

      // Assert original file still exists
      expect(fs.existsSync(testFilePath)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);

      // Clean up
      [testFilePath, targetPath].forEach(filePath => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
      try {
        if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length === 0) {
          fs.rmdirSync(targetDir);
        }
        const testUserDir = path.join(lmstudioModelsPath, "test");
        if (fs.existsSync(testUserDir) && fs.readdirSync(testUserDir).length === 0) {
          fs.rmdirSync(testUserDir);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    });
  });
});
