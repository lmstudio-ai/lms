/**
 * Tests for localizing the prompts inquirer renders itself.
 *
 * `navigate` / `select` / `No results found` are not options — the inquirer library hard-codes
 * them and
 * only exposes them through the theme, which is why they survived every earlier pass over the
 * help text and command output. `inquirerTheme.ts` is the single place they become
 * localizable, so that is what these tests pin down.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

/** Labels the library passes to `keysHelpTip`, in its default shape. */
const KEYS: Array<[string, string]> = [
  ["↑↓", "navigate"],
  ["⏎", "select"],
];

/** Re-imports the theme under a controlled locale (it is fixed when the module is evaluated). */
async function load(locale: string) {
  const vars = ["LMS_LANG", "LC_ALL", "LC_MESSAGES", "LANG"];
  const saved: Record<string, string | undefined> = {};
  for (const v of vars) saved[v] = process.env[v];
  for (const v of vars) delete process.env[v];
  process.env.LANG = locale;
  // chalk picks its level when it is first required, and resetModules gives it a fresh instance,
  // so the level must be forced through the environment rather than by assigning chalk.level.
  const prevForce = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "3";
  jest.resetModules();
  try {
    return await import("./inquirerTheme.js");
  } finally {
    if (prevForce === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = prevForce;
    for (const [k, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  }
}

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(ESC + "\\[[0-9;]*m", "g");
const plain = (s: string) => s.replace(ANSI, "");

describe("prompt theme", () => {
  afterEach(() => jest.resetModules());

  it("localizes the key help tip", async () => {
    const { searchTheme } = await load("zh_CN.UTF-8");
    const tip = plain(searchTheme.style.keysHelpTip(KEYS));
    expect(tip).toBe("↑↓ 导航 • ⏎ 选择");
    expect(tip).not.toContain("navigate");
    expect(tip).not.toContain("select");
  });

  it("keeps the key help tip in English", async () => {
    const { searchTheme } = await load("en_US.UTF-8");
    expect(plain(searchTheme.style.keysHelpTip(KEYS))).toBe("↑↓ navigate • ⏎ select");
  });

  it("preserves the library's styling and separator", async () => {
    const { searchTheme } = await load("zh_CN.UTF-8");
    {
      const tip = searchTheme.style.keysHelpTip(KEYS);
      // bold key, dim label, and the same bullet the library default joins with
      expect(tip).toContain(ESC + "[1m↑↓");
      expect(tip).toContain(ESC + "[2m");
      expect(tip).toContain("导航");
      expect(tip).toContain(" • ");
    }
  });

  it("localizes the no-results error and keeps the library prefix", async () => {
    const { searchTheme } = await load("zh_CN.UTF-8");
    expect(plain(searchTheme.style.error("No results found"))).toBe("> 无匹配结果");
    {
      // The library default is `styleText("red", "> " + text)`; the colour must survive.
      expect(searchTheme.style.error("No results found")).toContain(ESC + "[31m");
    }
  });

  it("passes an already-localized message through unchanged", async () => {
    const { searchTheme } = await load("zh_CN.UTF-8");
    // The prompt also feeds validator output through `style.error`; rewriting it twice would
    // corrupt text that is already Chinese.
    const already = "User 不能包含特殊字符";
    expect(plain(searchTheme.style.error(already))).toBe(`> ${already}`);
  });

  it("keeps the no-results error in English", async () => {
    const { searchTheme } = await load("en_US.UTF-8");
    expect(plain(searchTheme.style.error("No results found"))).toBe("> No results found");
  });
});

describe("prompt wiring", () => {
  const read = (rel: string) => {
    const candidates = [
      resolve(process.cwd(), "packages/lms-cli/src", rel),
      resolve(process.cwd(), "src", rel),
      resolve(__dirname, rel),
    ];
    const found = candidates.find(c => {
      try {
        readFileSync(c);
        return true;
      } catch {
        return false;
      }
    });
    expect(found).toBeDefined();
    return readFileSync(found as string, "utf8");
  };

  it("passes the theme to every select and search prompt", () => {
    const files = [
      "subcommands/get.ts",
      "subcommands/load.ts",
      "subcommands/importCmd.ts",
      "subcommands/unload.ts",
      "subcommands/create.ts",
      "subcommands/runtime/get.ts",
      "subcommands/link/setPreferredDevice.ts",
      "subcommands/chat/getLLM.ts",
    ];
    for (const f of files) {
      const source = read(f);
      const calls = (source.match(/(?<![\w.])(?:search|select)\s*(?:<[^>\n]*>)?\s*\(/g) ?? [])
        .length;
      const themes = (source.match(/theme:\s*searchTheme/g) ?? []).length;
      expect(`${f}: ${themes}/${calls}`).toBe(`${f}: ${calls}/${calls}`);
    }
  });

  it("renders confirm answers through t()", () => {
    for (const f of ["subcommands/importCmd.ts", "subcommands/chat/index.tsx"]) {
      expect(read(f)).toMatch(/transformer:.*\bt\("Yes"\).*\bt\("No"\)/);
    }
  });

  it("localizes every isValidFolderName validation message", () => {
    const source = read("subcommands/importCmd.ts");
    const body = source.slice(source.indexOf("function isValidFolderName"));
    const messages = [...body.matchAll(/return\s+(?:t\()?[`"]([^`"]+)[`"]\)?/g)];
    expect(messages.length).toBeGreaterThanOrEqual(5);
    const untranslated = [...body.matchAll(/return\s+[`"](?!\{p0\})([^`"]{8,})[`"]/g)].map(
      m => m[1],
    );
    expect(untranslated).toEqual([]);
  });
});
