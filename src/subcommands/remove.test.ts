import { join } from "path";
import { pathIsAtOrInside } from "./remove.js";

describe("remove", () => {
  describe("pathIsAtOrInside", () => {
    const modelsFolder = join("/home", "user", ".lmstudio", "models");

    it("returns true when the child is the same as the parent", () => {
      expect(pathIsAtOrInside(modelsFolder, modelsFolder)).toBe(true);
    });

    it("returns true for a directly nested path", () => {
      expect(pathIsAtOrInside(modelsFolder, join(modelsFolder, "publisher"))).toBe(true);
    });

    it("returns true for a deeply nested path", () => {
      expect(
        pathIsAtOrInside(modelsFolder, join(modelsFolder, "publisher", "repo", "model.gguf")),
      ).toBe(true);
    });

    it("returns false for a sibling whose name shares a prefix", () => {
      // "/.../models-backup" must NOT be considered inside "/.../models".
      expect(pathIsAtOrInside(modelsFolder, `${modelsFolder}-backup`)).toBe(false);
    });

    it("returns false for a parent of the parent", () => {
      expect(pathIsAtOrInside(modelsFolder, join("/home", "user", ".lmstudio"))).toBe(false);
    });

    it("returns false for a completely unrelated path", () => {
      expect(pathIsAtOrInside(modelsFolder, join("/tmp", "something"))).toBe(false);
    });
  });
});
