import { SimpleLogger } from "@lmstudio/lms-common";
import { z } from "zod";
import { SimpleFileData } from "./SimpleFileData.js";
import { cliPrefPath } from "./lmstudioPaths.js";

export async function getCliPref(logger?: SimpleLogger) {
  const cliPrefSchema = z.object({
    autoLaunchMinimizedWarned: z.boolean(),
    importWillMoveWarned: z.boolean().optional(),
    lastLoadedModels: z.array(z.string()).optional(),
    autoStartServer: z.boolean().optional(),
  });
  type CliPref = z.infer<typeof cliPrefSchema>;
  const defaultCliPref: CliPref = {
    autoLaunchMinimizedWarned: false,
    importWillMoveWarned: false,
    lastLoadedModels: [],
    autoStartServer: undefined,
  };
  const cliPref = new SimpleFileData(
    cliPrefPath,
    defaultCliPref,
    cliPrefSchema,
    new SimpleLogger("CliPref", logger),
  );
  await cliPref.init();
  return cliPref;
}
