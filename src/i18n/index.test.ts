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

describe("catalog invariants", () => {
  it("keeps the same placeholder set in every translation as in its English key", async () => {
    const { zhCN } = (await import("./zh-CN.js")) as { zhCN: Record<string, string> };
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(zhCN)) {
      const inKey = [...key.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
      const inValue = [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
      if (inKey.join(",") !== inValue.join(",")) {
        mismatches.push(`${JSON.stringify(key)}: [${inKey}] -> [${inValue}]`);
      }
    }
    // `Found {p0} device{p1}:` legitimately drops {p1}: English marks a plural with it, Chinese
    // has no plural morphology, so the marker is intentionally absent from the translation.
    const expected = ['"Found {p0} device{p1}:": [p0,p1] -> [p0]'];
    const unexpected = mismatches.filter(m => !expected.includes(m));
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
