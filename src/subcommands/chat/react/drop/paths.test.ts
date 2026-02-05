import { extractDroppedFilePaths } from "./paths.js";

describe("extractDroppedFilePaths", () => {
  it("parses a simple absolute path", () => {
    expect(extractDroppedFilePaths("/Users/me/cat.png")).toEqual(["/Users/me/cat.png"]);
  });

  it("parses a quoted path with spaces", () => {
    expect(extractDroppedFilePaths('"/Users/me/My Cat.png"')).toEqual(["/Users/me/My Cat.png"]);
  });

  it("parses multiple paths separated by whitespace", () => {
    expect(extractDroppedFilePaths('"/a/b.png" "/c/d.jpg"')).toEqual(["/a/b.png", "/c/d.jpg"]);
  });

  it("does not break Windows-style paths", () => {
    expect(extractDroppedFilePaths("C:\\Users\\me\\cat.png")).toEqual(["C:\\Users\\me\\cat.png"]);
  });

  it("decodes unicode code point escapes", () => {
    expect(
      extractDroppedFilePaths(
        '"/Users/me/Screenshot 2026-02-04 at 10.26.40\\u{202f}AM.png"',
      ),
    ).toEqual(["/Users/me/Screenshot 2026-02-04 at 10.26.40\u202fAM.png"]);
  });

  it("decodes unicode \\uXXXX escapes", () => {
    expect(extractDroppedFilePaths('"/Users/me/hello\\u00A0world.png"')).toEqual([
      "/Users/me/hello\u00a0world.png",
    ]);
  });

  it("preserves narrow no-break spaces in paths", () => {
    expect(
      extractDroppedFilePaths('"/Users/me/Screenshot 2026-02-04 at 10.26.40\u202fAM.png"'),
    ).toEqual(["/Users/me/Screenshot 2026-02-04 at 10.26.40\u202fAM.png"]);
  });

  it("preserves non-breaking spaces in paths", () => {
    expect(extractDroppedFilePaths('"/Users/me/hello\u00a0world.png"')).toEqual([
      "/Users/me/hello\u00a0world.png",
    ]);
  });
});
