import path from "path";
import { TEST_CLI_PATH, testRunCommandSync } from "../test-utils.js";

describe("version", () => {
  const cliPath = path.join(__dirname, TEST_CLI_PATH);

  describe("version command", () => {
    it("should display version with ASCII art", () => {
      const { status, stdout } = testRunCommandSync("node", [cliPath, "version"]);
      expect(status).toBe(0);
      expect(stdout).toContain("lms - LM Studio CLI");
      expect(stdout).toContain("GitHub: https://github.com/lmstudio-ai/lms");
    });

    it("should output JSON format when --json flag is used", () => {
      const { status, stdout } = testRunCommandSync("node", [cliPath, "version", "--json"]);
      expect(status).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty("version");
      expect(typeof parsed.version).toBe("string");
    });
  });
});
