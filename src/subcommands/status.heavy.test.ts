import path from "path";
import { CLI_PATH, runCommandSync } from "../util.js";

describe("status", () => {
  const cliPath = path.join(__dirname, CLI_PATH);

  describe("status command", () => {
    it("should show LM Studio status", () => {
      const { status } = runCommandSync("node", [
        cliPath,
        "status",
        "--host",
        "localhost",
        "--port",
        "1234",
      ]);
      expect(status).toBe(0);
    });
  });
});
