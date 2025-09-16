import { compareVersions } from "./compareVersions.js";

describe("Version Comparison Functions", () => {
  describe("compareVersions", () => {
    it("should return 1 when first version is newer", () => {
      expect(compareVersions("1.2.3", "1.2.2")).toBe(1);
      expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
      expect(compareVersions("0.0.11", "0.0.2")).toBe(1);
    });

    it("should return -1 when second version is newer", () => {
      expect(compareVersions("1.2.2", "1.2.3")).toBe(-1);
      expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
      expect(compareVersions("0.0.2", "0.0.11")).toBe(-1);
    });

    it("should return 0 when versions are equal", () => {
      expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    });

    it("should handle versions with leading zeros", () => {
      expect(compareVersions("1.01.3", "1.1.3")).toBe(0);
      expect(compareVersions("1.02.3", "1.1.3")).toBe(1);
    });

    it("should throw error for invalid version format", () => {
      expect(() => compareVersions("invalid", "1.2.3")).toThrow();
      expect(() => compareVersions("1.2.3", "invalid")).toThrow();
    });

    it("should throw error for incomplete version format", () => {
      expect(() => compareVersions("2.0", "1.2.3")).toThrow();
      expect(() => compareVersions("1.2.3", "2.0")).toThrow();
      expect(() => compareVersions("1", "1.2.3")).toThrow();
    });
  });
});
