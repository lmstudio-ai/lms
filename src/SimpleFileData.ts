import { type SimpleLogger } from "@lmstudio/lms-common";
import { type ZodSchema } from "zod";
import { FileData } from "./FileData.js";

export class SimpleFileData<TData> extends FileData<TData, TData> {
  public constructor(
    filePath: string,
    defaultData: TData,
    schema: ZodSchema<TData>,
    logger?: SimpleLogger,
  ) {
    super(
      filePath,
      defaultData,
      data => data,
      data => data,
      schema,
      logger,
    );
  }
}
