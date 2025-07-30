import path from "path";
import { runCommandSync } from "../util.js";

describe("status", () => {
  const cliPath = path.join(__dirname, "../../../../publish/cli/dist/index.js");

  describe("status command", () => {
    it("should show LM Studio status", () => {
      const { status } = runCommandSync(`node ${cliPath} status`);
      expect(status).toBe(0);
    });

    it("should show help when --help flag is used", () => {
      const { status, stdout } = runCommandSync(`node ${cliPath} status --help`);
      expect(status).toBe(1);
      expect(stdout).toContain("Prints the status of LM Studio");
    });

    it("should handle custom host", () => {
      const { status } = runCommandSync(`node ${cliPath} status --host localhost`);
      expect(status).toBe(0);
    });

    it("should handle custom port", () => {
      const { status } = runCommandSync(`node ${cliPath} status --port 8080`);
      expect(status).toBe(0);
    });

    it("should handle both custom host and port", () => {
      const { status } = runCommandSync(`node ${cliPath} status --host localhost --port 9000`);
      expect(status).toBe(0);
    });
  });
});
