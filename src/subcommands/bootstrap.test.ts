import path from "path";
import { runCommandSync } from "../util.js";

describe("bootstrap", () => {
  const cliPath = path.join(__dirname, "../../../../publish/cli/dist/index.js");

  it("should bootstrap CLI", () => {
    const { status } = runCommandSync(`node ${cliPath} bootstrap`);
    expect(status).toBe(0);
  });
});
