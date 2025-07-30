import path from "path";
import { runCommandSync } from "../util.js";

describe("server", () => {
  const cliPath = path.join(__dirname, "../../../../publish/cli/dist/index.js");

  describe("server start", () => {
    it("should start server with default port", () => {
      const { status, stderr } = runCommandSync("node", [cliPath, "server", "start"]);
      if (status !== 0) console.error("Server start stderr:", stderr);
      expect(status).toBe(0);
    });

    it("should start server with custom port", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "server",
        "start",
        "--port",
        "8080",
      ]);
      if (status !== 0) console.error("Server start stderr:", stderr);
      expect(status).toBe(0);
    });

    it("should start server with short port flag", () => {
      const { status, stderr } = runCommandSync("node", [cliPath, "server", "start", "-p", "9000"]);
      if (status !== 0) console.error("Server start stderr:", stderr);
      expect(status).toBe(0);
    });

    it("should start server with CORS enabled", () => {
      const { status, stderr } = runCommandSync("node", [cliPath, "server", "start", "--cors"]);
      if (status !== 0) console.error("Server start stderr:", stderr);
      expect(status).toBe(0);
    });

    it("should start server with custom port and CORS", () => {
      const { status, stderr } = runCommandSync("node", [
        cliPath,
        "server",
        "start",
        "-p",
        "9000",
        "--cors",
      ]);
      if (status !== 0) console.error("Server start stderr:", stderr);
      expect(status).toBe(0);
    });

    it("should show help when --help flag is used", () => {
      const { status, stdout } = runCommandSync("node", [cliPath, "server", "start", "--help"]);
      expect(status).toBe(1);
      expect(stdout).toContain("Starts the local server");
    });
  });
  // Disable this test for now as it needs an update in the docker image.
  // describe("server stop", () => {
  //   it("should stop the server", () => {
  //     const { status, stderr } = runCommandSync("node", [cliPath, "server", "stop"]);
  //     if (status !== 0) console.error("Server stop stderr:", stderr);
  //     expect(status).toBe(0);
  //   });

  //   it("should show help when --help flag is used", () => {
  //     const { status, stdout } = runCommandSync("node", [cliPath, "server", "stop", "--help"]);
  //     expect(status).toBe(1);
  //     expect(stdout).toContain("Stops the local server");
  //   });
  // });

  describe("server status", () => {
    it("should show server status", () => {
      const { status, stderr } = runCommandSync("node", [cliPath, "server", "status"]);
      if (status !== 0) console.error("Server status stderr:", stderr);
      expect(status).toBe(0);
    });

    it("should output JSON format", () => {
      const { status, stdout, stderr } = runCommandSync("node", [
        cliPath,
        "server",
        "status",
        "--json",
      ]);
      if (status !== 0) console.error("Server status stderr:", stderr);
      expect(status).toBe(0);
      if (stdout.trim()) {
        expect(() => JSON.parse(stdout)).not.toThrow();
      }
    });

    it("should show help when --help flag is used", () => {
      const { status, stdout } = runCommandSync("node", [cliPath, "server", "status", "--help"]);
      expect(status).toBe(1);
      expect(stdout).toContain("Displays the status of the local server");
    });
  });

  describe("server command help", () => {
    it("should show help for server command", () => {
      const { status, stdout } = runCommandSync("node", [cliPath, "server", "--help"]);
      expect(status).toBe(1);
      expect(stdout).toContain("Commands for managing the local server");
    });
  });
});
