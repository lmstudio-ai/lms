import { type SimpleLogger } from "@lmstudio/lms-common";
import { LMStudioClient } from "@lmstudio/sdk";

export function createClient(logger: SimpleLogger) {
  return new LMStudioClient({
    logger,
  });
}
