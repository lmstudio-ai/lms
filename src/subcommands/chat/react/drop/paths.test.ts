import { extractDroppedFilePaths } from "./paths.js";

describe("extractDroppedFilePaths", () => {
  it("parses a simple absolute path", () => {
    expect(extractDroppedFilePaths("/Users/me/cat.png")).toEqual(["/Users/me/cat.png"]);
  });

  it("parses a quoted path with spaces", () => {
    expect(extractDroppedFilePaths('"/Users/me/My Cat.png"')).toEqual(["/Users/me/My Cat.png"]);
  });

  it("parses backslash-escaped spaces", () => {
    expect(extractDroppedFilePaths("/Users/me/My\\ Cat.png")).toEqual(["/Users/me/My Cat.png"]);
  });

  it("parses multiple paths separated by whitespace", () => {
    expect(extractDroppedFilePaths('"/a/b.png" "/c/d.jpg"')).toEqual(["/a/b.png", "/c/d.jpg"]);
  });

  it("handles wrapped escaped paths (backslash-newline)", () => {
    expect(extractDroppedFilePaths("/Users/me/Screenshot\\\n  6.png")).toEqual([
      "/Users/me/Screenshot 6.png",
    ]);
  });

  it("strips literal bracketed paste markers", () => {
    expect(extractDroppedFilePaths("[200~/a/b.png [201~")).toEqual(["/a/b.png"]);
  });

  it("splits concatenated duplicate absolute paths", () => {
    expect(extractDroppedFilePaths("/Users/me/a.png/Users/me/b.png")).toEqual([
      "/Users/me/a.png",
      "/Users/me/b.png",
    ]);
  });

  it("does not break Windows-style paths", () => {
    expect(extractDroppedFilePaths("C:\\Users\\me\\cat.png")).toEqual(["C:\\Users\\me\\cat.png"]);
  });
});
