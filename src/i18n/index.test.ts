import { resolve } from "path";
/**
 * Tests for the i18n layer.
 *
 * These are the tests that prove the localization actually works. The rest of the suite only
 * proves that assertions go through `t()` — if `resolveLocale()` were hard-wired to `"en"`, every
 * other test would still pass and Chinese output would silently disappear. Each test below is
 * written so that breaking the behaviour it covers makes it fail.
 */

/** Every variable `resolveLocale()` reads. Cleared first so a test only sees what it asks for. */
const LOCALE_VARS = ["LMS_LANG", "LC_ALL", "LC_MESSAGES", "LANG"];

/**
 * Re-imports the i18n module with a controlled environment.
 *
 * The locale is resolved while the module is evaluated, so `process.env` must be set before the
 * import — which is why this helper resets the module registry instead of just calling `t()`.
 */
async function loadWithEnv(env: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of [...LOCALE_VARS, ...Object.keys(env)]) previous[key] = process.env[key];
  // LC_ALL outranks LANG, so a leftover value here would shadow the locale under test.
  for (const key of LOCALE_VARS) delete process.env[key];
  Object.assign(process.env, env);
  jest.resetModules();
  try {
    return await import("./index.js");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const SAMPLE = "Load a model";
const SAMPLE_ZH = "加载模型";

describe("locale detection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    jest.resetModules();
  });

  it("renders Simplified Chinese for a zh-CN POSIX locale", async () => {
    const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
    expect(t(SAMPLE)).toBe(SAMPLE_ZH);
  });

  it("renders Simplified Chinese for a zh-SG POSIX locale", async () => {
    const { t } = await loadWithEnv({ LANG: "zh_SG.UTF-8" });
    expect(t(SAMPLE)).toBe(SAMPLE_ZH);
  });

  it("lets LC_ALL outrank LC_MESSAGES and LANG", async () => {
    const { t } = await loadWithEnv({
      LC_ALL: "zh_CN.UTF-8",
      LC_MESSAGES: "en_US.UTF-8",
      LANG: "en_US.UTF-8",
    });
    expect(t(SAMPLE)).toBe(SAMPLE_ZH);
  });

  it("lets LC_MESSAGES outrank LANG", async () => {
    const { t } = await loadWithEnv({ LC_MESSAGES: "zh_CN.UTF-8", LANG: "en_US.UTF-8" });
    expect(t(SAMPLE)).toBe(SAMPLE_ZH);
  });

  it("renders English for an English POSIX locale", async () => {
    const { t } = await loadWithEnv({ LANG: "en_US.UTF-8" });
    expect(t(SAMPLE)).toBe(SAMPLE);
  });

  it.each(["ja_JP.UTF-8", "fr_FR.UTF-8", "de_DE.UTF-8", "ko_KR.UTF-8", "ru_RU.UTF-8"])(
    "renders English for %s rather than falling back to Chinese",
    async locale => {
      const { t } = await loadWithEnv({ LANG: locale });
      expect(t(SAMPLE)).toBe(SAMPLE);
    },
  );

  // Only a Simplified catalog ships with the CLI, so Traditional environments must not get
  // Simplified text.
  it.each(["zh_TW.UTF-8", "zh_HK.UTF-8", "zh_Hant"])(
    "renders English for Traditional Chinese %s",
    async locale => {
      const { t } = await loadWithEnv({ LANG: locale });
      expect(t(SAMPLE)).toBe(SAMPLE);
    },
  );

  // `C`/`POSIX` state no preference. Resolving `C` as if it were a language would pin every
  // `C`-default terminal to English instead of consulting the system language.
  it.each(["C", "C.UTF-8", "C.utf8", "POSIX", "POSIX.UTF-8", "  c  "])(
    "treats %s as no language preference",
    async value => {
      const { isNeutralPosixLocale } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
      expect(isNeutralPosixLocale(value)).toBe(true);
    },
  );

  it.each(["zh_CN.UTF-8", "en_US.UTF-8", "ja_JP.UTF-8", "de_DE.UTF-8", "zz_ZZ.UTF-8"])(
    "does not treat %s as neutral",
    async value => {
      const { isNeutralPosixLocale } = await loadWithEnv({ LANG: "en_US.UTF-8" });
      expect(isNeutralPosixLocale(value)).toBe(false);
    },
  );

  // Simplified-only selection, asserted directly rather than only through t().
  it.each([
    ["zh", true],
    ["zh_CN.UTF-8", true],
    ["zh_SG", true],
    ["zh-Hans-CN", true],
    ["zh-Hans", true],
    ["zh_TW.UTF-8", false],
    ["zh_HK", false],
    ["zh-Hant-TW", false],
    ["zh-MO", false],
    ["en_US.UTF-8", false],
    ["ja_JP.UTF-8", false],
  ] as Array<[string, boolean]>)("classifies %s as Simplified=%s", async (tag, expected) => {
    const { isSimplifiedChineseTag } = await loadWithEnv({ LANG: "en_US.UTF-8" });
    expect(isSimplifiedChineseTag(tag)).toBe(expected);
  });

  it("honours an explicit LMS_LANG override over the POSIX locale", async () => {
    const zh = await loadWithEnv({ LMS_LANG: "zh-CN", LANG: "en_US.UTF-8" });
    expect(zh.t(SAMPLE)).toBe(SAMPLE_ZH);
    const en = await loadWithEnv({ LMS_LANG: "en", LANG: "zh_CN.UTF-8" });
    expect(en.t(SAMPLE)).toBe(SAMPLE);
  });
});

describe("translation lookup", () => {
  it("falls back to the English source when a key has no translation", async () => {
    const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
    const unknown = "This key does not exist in the catalog";
    expect(t(unknown)).toBe(unknown);
  });

  it("interpolates placeholders", async () => {
    const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
    expect(t("Server: {status} (port: {port})", { status: "ON", port: 1234 })).toBe(
      "服务器：ON（端口：1234）",
    );
  });

  it("renders an empty string for a null placeholder value", async () => {
    const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
    expect(t("Server: {status} (port: {port})", { status: null, port: 1 })).toBe(
      "服务器：（端口：1）",
    );
  });

  it("keeps an unknown placeholder verbatim instead of dropping it", async () => {
    const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
    expect(t("Server: {status} (port: {port})", { status: "ON" })).toBe(
      "服务器：ON（端口：{port}）",
    );
  });

  it("translates the chat welcome screen shown on `lms chat`", async () => {
    const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
    expect(t("Try one of the following commands:")).toBe("试试以下命令：");
    expect(t("/model - Load a model (type /model to see list)")).toBe(
      "/model - 加载模型（输入 /model 查看列表）",
    );
    expect(t("Type a message or use / to use commands")).toBe("输入消息，或使用 / 调用命令");
  });

  it("translates help text", async () => {
    const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
    expect(t("Prints the status of LM Studio")).toBe("打印 LM Studio 状态");
    expect(t("Load a model")).toBe(SAMPLE_ZH);
  });
});

describe("help section titles", () => {
  // commander builds these headings itself, so nothing else in the suite notices if they stop
  // being localized — help would silently fall back to English while every description stayed
  // Chinese.
  const TITLES: Array<[string, string]> = [
    ["Usage:", "用法："],
    ["Options:", "选项："],
    ["Arguments:", "参数："],
    ["Global Options:", "全局选项："],
    ["Commands:", "命令："],
  ];

  it.each(TITLES)("localizes the %j section title", async (source, expected) => {
    const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
    expect(t(source)).toBe(expected);
  });

  it.each(TITLES)("keeps the %j section title in English", async source => {
    const { t } = await loadWithEnv({ LANG: "en_US.UTF-8" });
    expect(t(source)).toBe(source);
  });

  it("feeds commander's headings through t()", async () => {
    // styleTitle is the only hook commander exposes for them; losing the call would leave
    // `Usage:` / `Options:` in English no matter what the catalog says.
    const { readFileSync } = await import("fs");
    const candidates = [
      resolve(process.cwd(), "packages/lms-cli/src/index.ts"),
      resolve(process.cwd(), "src/index.ts"),
      resolve(__dirname, "index.ts"),
      resolve(__dirname, "..", "index.ts"),
    ];
    const path = candidates.find(p => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    });
    expect(path).toBeDefined();
    const lines = readFileSync(path as string, "utf8").split("\n");
    const hook = /styleTitle\s*:\s*(?:title|str|heading)\s*=>\s*t\(/;
    expect(
      lines.findIndex(line => hook.test(line) && !line.trimStart().startsWith("//")),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("table headers", () => {
  // columnify pads cells with wcwidth, so CJK headings stay aligned; without that, translating
  // them would silently misalign every table. These assertions keep the wording in place and the
  // wiring that feeds headings through t() intact.
  const HEADERS: Array<[string, string]> = [
    ["PARAMS", "参数"],
    ["ARCH", "架构"],
    ["SIZE", "大小"],
    ["DEVICE", "设备"],
    ["IDENTIFIER", "标识符"],
    ["MODEL", "模型"],
    ["STATUS", "状态"],
    ["CONTEXT", "上下文"],
    ["PARALLEL", "并行"],
    ["LOAD CONFIG", "加载配置"],
    ["LLM ENGINE", "LLM 引擎"],
    ["SELECTED", "已选择"],
    ["MODEL FORMAT", "模型格式"],
    ["GPU/ACCELERATORS", "GPU/加速器"],
    ["EMBEDDING", "嵌入模型"],
    ["LATEST LOCAL", "最新本地"],
    ["AVAILABLE", "可用"],
    ["NAME", "名称"],
  ];

  it.each(HEADERS)("localizes the %j column heading", async (heading, expected) => {
    const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
    expect(t(heading)).toBe(expected);
  });

  // Acronyms must stay as they are; translating them would contradict the terminology rules.
  it.each(["TTL", "VRAM", "LLM", "GGUF", "MLX", "GPU"])(
    "keeps the acronym %j in English",
    async acronym => {
      const { t } = await loadWithEnv({ LANG: "zh_CN.UTF-8" });
      expect(t(acronym)).toBe(acronym);
    },
  );

  it("feeds column headings through t()", async () => {
    const { readFileSync } = await import("fs");
    const candidates = [
      resolve(process.cwd(), "packages/lms-cli/src/subcommands/list.ts"),
      resolve(process.cwd(), "src/subcommands/list.ts"),
      resolve(__dirname, "..", "subcommands", "list.ts"),
      resolve(__dirname, "..", "list.ts"),
    ];
    const path = candidates.find(c => {
      try {
        readFileSync(c);
        return true;
      } catch {
        return false;
      }
    });
    expect(path).toBeDefined();
    const source = readFileSync(path as string, "utf8");
    // Every literal heading in a headingTransform must be wrapped; `TTL` is the one acronym we
    // deliberately leave alone.
    const literal = [...source.matchAll(/headingTransform:\s*\(\)\s*=>\s*chalk\.dim\("([^"]+)"\)/g)]
      .map(m => m[1])
      .filter(h => h !== "TTL" && h !== "");
    expect(literal).toEqual([]);
  });
});

describe("catalog invariants", () => {
  it("keeps the same placeholder set in every translation as in its English key", async () => {
    const { zhCN } = (await import("./zh-CN.js")) as { zhCN: Record<string, string> };
    // Placeholders that appear only in the English key, each with the reason it may vanish.
    const englishOnly = new Map<string, string>([
      ["p1", "`Found {p0} device{p1}:` — English marks a plural with it"],
      ["s", "`too many arguments ... argument{s}` — English marks a plural with it"],
    ]);
    const unexpected: string[] = [];
    for (const [key, value] of Object.entries(zhCN)) {
      const inKey = [...key.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      const inValue = [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      // A translation must never invent a placeholder the source does not define: it would
      // render a literal `{name}` or swallow an unrelated value.
      const invented = inValue.filter(name => !inKey.includes(name));
      if (invented.length > 0) {
        unexpected.push(`${JSON.stringify(key)}: translation adds {${invented.join("}, {")}}`);
        continue;
      }
      const dropped = inKey.filter(name => !inValue.includes(name) && !englishOnly.has(name));
      if (dropped.length > 0) {
        unexpected.push(`${JSON.stringify(key)}: translation drops {${dropped.join("}, {")}}`);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it("does not leave any value identical to its English key except intentional non-prose", async () => {
    const { zhCN } = (await import("./zh-CN.js")) as { zhCN: Record<string, string> };
    // These are commands/identifiers that must stay verbatim; everything else must be translated.
    const allowUntranslated = new Set([
      "  lms runtime select {p0}@{p1}",
      "Markdown",
      "LM Studio",
      "{{modelName}}",
    ]);
    const untranslated = Object.entries(zhCN)
      .filter(([key, value]) => key === value && /\w{3}\s+\w{3}/.test(key))
      .map(([key]) => key)
      .filter(key => !allowUntranslated.has(key));
    expect(untranslated).toEqual([]);
  });

  it("uses full-width punctuation inside Chinese prose", async () => {
    const { zhCN } = (await import("./zh-CN.js")) as { zhCN: Record<string, string> };
    const offenders: string[] = [];
    for (const value of Object.values(zhCN)) {
      if (!/[一-鿿]/.test(value)) continue;
      const scrubbed = value
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\{[^}]*\}/g, "")
        .replace(/\d+\.\d+/g, "")
        .replace(/\.\.\./g, "")
        .replace(/--[\w-]+/g, "")
        .replace(/['"`][^'"`]*['"`]/g, "");
      if (/(?<=[一-鿿])[,:;!?](?![\d}])|(?<=[一-鿿])\.(?![\w/])/.test(scrubbed)) {
        offenders.push(value);
      }
      // Only a literal space is wrong: a full-width colon followed by a newline is correct,
      // because a multi-line command block follows the sentence.
      if (/[一-鿿]： +/.test(value)) offenders.push(value);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps flag names and command names verbatim in translations", async () => {
    const { zhCN } = (await import("./zh-CN.js")) as { zhCN: Record<string, string> };
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(zhCN)) {
      for (const flag of key.match(/(?<![\w.])-{1,2}[a-z][\w-]{1,}/g) ?? []) {
        if (!value.includes(flag)) offenders.push(`${flag} missing from ${JSON.stringify(key)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
