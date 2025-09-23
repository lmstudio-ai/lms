import chalk from "chalk";

export class InfoLookup<TInnerKey, TLookupKey, TValue> {
  private readonly lookup = new Map<TInnerKey, TValue>();
  private readonly fallback: (key: TLookupKey) => TValue;

  private constructor(
    private readonly keyMapper: (key: TLookupKey) => TInnerKey,
    fallback: ((key: TLookupKey) => TValue) | undefined,
  ) {
    this.fallback =
      fallback ??
      (key => {
        throw new Error(`Key not found: ${key}`);
      });
  }

  public static create<TKey, TValue>({ fallback }: { fallback?: (key: TKey) => TValue } = {}) {
    return new InfoLookup<TKey, TKey, TValue>(key => key, fallback);
  }

  public static createWithKeyMapper<TInnerKey, TLookupKey, TValue>({
    fallback,
    keyMapper,
  }: {
    fallback: (key: TLookupKey) => TValue;
    keyMapper: (key: TLookupKey) => TInnerKey;
  }) {
    return new InfoLookup<TInnerKey, TLookupKey, TValue>(keyMapper, fallback);
  }

  public register(...args: [...TInnerKey[], TValue]): this {
    const value = args.at(-1) as TValue;
    for (let i = 0; i < args.length - 1; i++) {
      this.lookup.set(args[i] as TInnerKey, value);
    }
    return this;
  }

  public find(lookupKey: TLookupKey): TValue {
    const innerKey = this.keyMapper(lookupKey);
    if (this.lookup.has(innerKey)) {
      return this.lookup.get(innerKey)!;
    } else {
      return this.fallback(lookupKey);
    }
  }
}

const llmColorer = chalk.cyan;
const visionColorer = chalk.yellow;
const embeddingColorer = chalk.blue;

export const architectureInfoLookup = InfoLookup.createWithKeyMapper({
  fallback: (arch: string) => ({
    name: arch,
    colorer: llmColorer,
  }),
  keyMapper: (arch: string) => arch.toLowerCase(),
})
  .register("phi2", "phi-2", {
    name: "Phi-2",
    colorer: llmColorer,
  })
  .register("phi3", "phi-3", {
    name: "Phi-3",
    colorer: llmColorer,
  })
  .register("mistral", {
    name: "Mistral",
    colorer: llmColorer,
  })
  .register("llama", {
    name: "Llama",
    colorer: llmColorer,
  })
  .register("gptneox", "gpt-neo-x", "gpt_neo_x", {
    name: "GPT-NeoX",
    colorer: llmColorer,
  })
  .register("mpt", {
    name: "MPT",
    colorer: llmColorer,
  })
  .register("replit", {
    name: "Replit",
    colorer: llmColorer,
  })
  .register("starcoder", {
    name: "StarCoder",
    colorer: llmColorer,
  })
  .register("falcon", {
    name: "Falcon",
    colorer: llmColorer,
  })
  .register("qwen", {
    name: "Qwen",
    colorer: llmColorer,
  })
  .register("qwen2", {
    name: "Qwen2",
    colorer: llmColorer,
  })
  .register("stablelm", {
    name: "StableLM",
    colorer: llmColorer,
  })
  .register("mamba", {
    name: "mamba",
    colorer: llmColorer,
  })
  .register("command-r", {
    name: "Command R",
    colorer: llmColorer,
  })
  .register("gemma", {
    name: "Gemma",
    colorer: llmColorer,
  })
  .register("gemma2", {
    name: "Gemma 2",
    colorer: llmColorer,
  })
  .register("deepseek2", {
    name: "DeepSeek 2",
    colorer: llmColorer,
  })
  .register("bert", {
    name: "BERT",
    colorer: embeddingColorer,
  })
  .register("nomic-bert", {
    name: "Nomic BERT",
    colorer: embeddingColorer,
  })
  .register("clip", {
    name: "CLIP",
    colorer: visionColorer,
  });
