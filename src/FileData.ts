import {
  isAvailable,
  Signal,
  type Setter,
  type SimpleLogger,
  type StripNotAvailable,
} from "@lmstudio/lms-common";
import { existsSync, writeFileSync } from "fs";
import { mkdir, readFile, watch } from "fs/promises";
import path from "path";
import { type ZodSchema } from "zod";

const fileDataGlobalCache: Map<string, FileData<any, any>> = new Map();

export type InitializationState =
  | {
      type: "notStarted";
    }
  | {
      type: "initializing";
      promise: Promise<void>;
    }
  | {
      type: "initialized";
    };

export class FileData<TData, TSerialized> {
  public get dataSignal(): Signal<TData> {
    if (this.initializationState.type !== "initialized") {
      throw new Error(
        "FileData is not initialized yet, cannot access dataSignal. (Must call init() first)",
      );
    }
    return this.internalDataSignal;
  }
  private readonly internalDataSignal!: Signal<TData>;
  private readonly setData!: Setter<TData>;
  private lastWroteString: string | null = null;
  private initializationState: InitializationState = { type: "notStarted" };
  public constructor(
    private readonly filePath: string,
    private readonly defaultData: TData,
    private readonly serializer: (data: TData) => TSerialized,
    private readonly deserializer: (serialized: TSerialized) => TData,
    private readonly serializedSchema: ZodSchema<TSerialized>,
    private readonly logger?: SimpleLogger,
  ) {
    if (fileDataGlobalCache.has(filePath)) {
      logger?.debug("FileData already exists in cache, returning existing instance.");
      return fileDataGlobalCache.get(filePath) as FileData<TData, TSerialized>;
    }
    [this.internalDataSignal, this.setData] = Signal.create(defaultData);
    fileDataGlobalCache.set(filePath, this);
  }

  public async init() {
    if (this.initializationState.type === "initializing") {
      await this.initializationState.promise;
      return;
    }
    if (this.initializationState.type === "initialized") {
      return;
    }
    const initPromise = this.initInternal();
    this.initializationState = { type: "initializing", promise: initPromise };
    await initPromise;
    this.initializationState = { type: "initialized" };
  }

  private async initInternal() {
    this.logger?.debug("Initializing FileData");
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    let data: TData | null = null;
    if (!existsSync(this.filePath)) {
      this.logger?.debug("File does not exist, writing default data");
      this.writeData(this.defaultData);
    } else {
      data = await this.readData();
    }
    if (data === null) {
      data = this.defaultData;
    }
    this.setData(data as StripNotAvailable<TData>);
    this.startWatcher().catch(e => {
      this.logger?.error(`Watcher failed: ${e}`);
    });
  }

  private async startWatcher() {
    const watcher = watch(this.filePath, {
      persistent: false,
    });
    for await (const event of watcher) {
      if (event.eventType === "change") {
        this.logger?.debug("File changed, reading data");
        const data: TData | null = await this.readData();
        if (data !== null && isAvailable(data)) {
          this.setData(data as any);
        }
      }
    }
  }

  private async readData(): Promise<TData | null> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      if (content === this.lastWroteString) {
        this.logger?.debug("File content is the same as last written, skipping read");
        return null;
      }
      const json = JSON.parse(content);
      const parsed = this.serializedSchema.parse(json);
      const data = this.deserializer(parsed);
      return data;
    } catch (e) {
      this.logger?.error(`Error reading data from file: ${e}`);
      return null;
    }
  }

  private writeData(data: TData) {
    const serialized = this.serializer(data);
    const json = JSON.stringify(serialized, null, 2);
    if (json === this.lastWroteString) {
      return;
    }
    this.lastWroteString = json;
    try {
      writeFileSync(this.filePath, json);
    } catch (e) {
      this.logger?.error(`Error writing data to file: ${e}`);
    }
  }

  public set(data: TData) {
    if (!isAvailable(data)) {
      throw new Error("Cannot set data to NOT_AVAILABLE");
    }
    this.setData(data);
    this.writeData(this.dataSignal.get());
  }

  public setWithProducer(producer: (draft: TData) => void) {
    this.setData.withProducer(producer);
    this.writeData(this.dataSignal.get());
  }

  public get() {
    return this.dataSignal.get();
  }
}
