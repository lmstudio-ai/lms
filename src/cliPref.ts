import { SimpleLogger } from "@lmstudio/lms-common";
import os from "os";
import path from "path";
import { z } from "zod";
import { SimpleFileData } from "./SimpleFileData";

export async function getCliPref(logger?: SimpleLogger) {
  const cliPrefSchema = z.object({
    autoLaunchMinimizedWarned: z.boolean(),
  });
  type CliPref = z.infer<typeof cliPrefSchema>;
  const defaultCliPref: CliPref = {
    autoLaunchMinimizedWarned: false,
  };
  const cliPref = new SimpleFileData(
    path.join(os.homedir(), ".cache/lm-studio/.internal/cli-pref.json"),
    defaultCliPref,
    cliPrefSchema,
    new SimpleLogger("CliPref", logger),
  );
  await cliPref.init();
  return cliPref;
}
