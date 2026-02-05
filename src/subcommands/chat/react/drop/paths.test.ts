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
});
