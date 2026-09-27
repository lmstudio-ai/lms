/**
 * Tests for localization of commander's own error strings.
 *
 * These strings are assembled inside commander at call time, so nothing else in the suite would
 * notice if they stopped being localized — the tests assert both directions: Simplified Chinese
 * rewrites them, every other locale returns the input byte-for-byte, and unrecognised shapes are
 * never touched.
 */

import { Command } from "@commander-js/extra-typings";
import { readFileSync } from "fs";
import { resolve } from "path";

/** commander messages observed from the CLI, one per rule in `commanderErrors.ts`. */
const SAMPLES: Array<[input: string, expectedFragment: string]> = [
  ["error: missing required argument 'file-path'", "缺少必需参数 'file-path'"],
  [
    "error: too many arguments for 'get'. Expected 1 argument but got 3.",
    "'get' 的参数过多。期望 1 个参数，但收到 3 个。",
  ],
  [
    "error: too many arguments. Expected 2 arguments but got 4.",
    "参数过多。期望 2 个参数，但收到 4 个。",
  ],
  ["error: unknown command 'foo'", "未知命令 'foo'"],
  ["error: unknown option '--nonsense'", "未知选项 '--nonsense'"],
  [
    "error: option '-c, --context-length <length>' argument 'abc' is invalid.",
    "选项 '-c, --context-length <length>' 的参数 'abc' 无效。",
  ],
  ["error: option '-p, --port <port>' argument missing", "选项 '-p, --port <port>' 缺少参数"],
  [
    "error: required option '--codebase <path>' not specified",
    "未指定必需选项 '--codebase <path>'",
  ],
  [
    "error: option '--gpu' value 'yes' from env 'LMS_GPU' is invalid.",
    "来自环境变量 'LMS_GPU' 的选项 '--gpu' 值 'yes' 无效。",
  ],
  [
    "error: command-argument value 'x' is invalid for argument 'name'.",
    "命令参数 'name' 的值 'x' 无效。",
  ],
  ["error: something commander wrote that we have never seen", "错误：something commander wrote"],
];

/** Re-imports the module under a controlled locale (the locale is fixed at module load). */
async function load(locale: string) {
  const vars = ["LMS_LANG", "LC_ALL", "LC_MESSAGES", "LANG"];
  const saved: Record<string, string | undefined> = {};
  for (const v of vars) saved[v] = process.env[v];
  for (const v of vars) delete process.env[v];
  process.env.LANG = locale;
  jest.resetModules();
  try {
    return await import("./commanderErrors.js");
  } finally {
    for (const [k, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  }
}

describe("localizeCommanderError", () => {
  afterEach(() => jest.resetModules());

  it.each(SAMPLES)("localizes %j", async (input, fragment) => {
    const { localizeCommanderError } = await load("zh_CN.UTF-8");
    const out = localizeCommanderError(input);
    expect(out).not.toBe(input);
    expect(out).toContain(fragment);
  });

  it.each(SAMPLES)("returns %j unchanged in English", async input => {
    const { localizeCommanderError } = await load("en_US.UTF-8");
    expect(localizeCommanderError(input)).toBe(input);
  });

  it("returns an unrecognised shape unchanged", async () => {
    const { localizeCommanderError } = await load("zh_CN.UTF-8");
    // Without the `error: ` marker there is no rule to apply; a real message must survive intact
    // rather than be dropped or half-rewritten.
    for (const plain of [
      "Permission denied.",
      "error without colon",
      "服务器正在端口 1234 上运行。",
      "",
    ]) {
      expect(localizeCommanderError(plain)).toBe(plain);
    }
  });

  it("keeps the parser's own reason after localizing the wrapper", async () => {
    const { localizeCommanderError } = await load("zh_CN.UTF-8");
    const out = localizeCommanderError(
      "error: option '-c, --context-length <length>' argument 'abc' is invalid. 不是数字",
    );
    expect(out).toBe("错误：选项 '-c, --context-length <length>' 的参数 'abc' 无效。不是数字");
  });
});

describe("installCommanderErrorLocalization", () => {
  it("localizes errors raised by the root command", async () => {
    const { installCommanderErrorLocalization } = await load("zh_CN.UTF-8");
    const cmd = new Command().name("demo").argument("<file>", "path");
    installCommanderErrorLocalization(cmd);

    let captured = "";
    cmd.configureOutput({
      writeErr: str => {
        captured += str;
      },
      writeOut: str => {
        captured += str;
      },
    });
    cmd.exitOverride();
    expect(() => cmd.parse(["node", "demo"], { from: "node" })).toThrow();

    expect(captured).toContain("缺少必需参数");
    expect(captured).not.toContain("missing required argument");
  });

  it("reaches subcommands registered with addCommand, not just .command()", async () => {
    const { installCommanderErrorLocalization } = await load("zh_CN.UTF-8");
    // addCommand() does not copy _outputConfiguration, which is why the tree is walked.
    const sub = new Command().name("sub").argument("<name>", "who");
    const root = new Command().name("demo").addCommand(sub);
    installCommanderErrorLocalization(root);

    let captured = "";
    sub.configureOutput({
      writeErr: str => {
        captured += str;
      },
      writeOut: str => {
        captured += str;
      },
    });
    sub.exitOverride();
    expect(() => sub.parse(["node", "sub"], { from: "node" })).toThrow();

    expect(captured).toContain("缺少必需参数");
  });

  it("leaves a command that installed its own handler alone", async () => {
    const { installCommanderErrorLocalization, markCustomErrorOutput } = await load("zh_CN.UTF-8");
    const cmd = new Command().name("demo").argument("<file>", "path");
    const calls: string[] = [];
    markCustomErrorOutput(cmd);
    cmd.configureOutput({
      outputError: (str, write) => {
        calls.push(str);
        write(str);
      },
    });

    installCommanderErrorLocalization(cmd);

    cmd.configureOutput({
      writeErr: () => {},
      writeOut: () => {},
    });
    cmd.exitOverride();
    expect(() => cmd.parse(["node", "demo"], { from: "node" })).toThrow();

    // Our installer must not have replaced the caller-supplied handler.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("missing required argument");
  });
});

describe("entry point wiring", () => {
  // `src/index.ts` parses arguments as soon as it is imported, so its behaviour cannot be
  // exercised from a test. The localized output itself is covered above; what is left is the
  // one line that installs it, and forgetting that line would ship every commander error in
  // English again — hence this contract.
  it("installs error localization before parsing", () => {
    const candidates = [
      resolve(process.cwd(), "packages/lms-cli/src/index.ts"),
      resolve(process.cwd(), "src/index.ts"),
      resolve(__dirname, "index.ts"),
      resolve(__dirname, "..", "index.ts"),
    ];
    const sourcePath = candidates.find(p => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    });
    expect(sourcePath).toBeDefined();
    const source = readFileSync(sourcePath as string, "utf8");
    const lines = source.split("\n");
    const call = /\binstallCommanderErrorLocalization\(\s*program\s*\)/;
    // The call has to be live code: matching it inside a comment would make this test pass
    // while the feature is switched off.
    const installLine = lines.findIndex(
      line => call.test(line) && !line.trimStart().startsWith("//"),
    );
    expect(installLine).toBeGreaterThanOrEqual(0);
    // …and it has to run before parseAsync, otherwise errors raised while parsing keep the
    // output configuration the command was constructed with.
    const parseLine = lines.findIndex(line => line.includes("program.parseAsync"));
    expect(parseLine).toBeGreaterThan(installLine);
  });
});
