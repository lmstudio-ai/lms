import { SimpleLogger } from "@lmstudio/lms-common";
import { z } from "zod";
import { SimpleFileData } from "./SimpleFileData.js";
import { cliPrefPath } from "./lmstudioPaths.js";

const cliPrefSchema = z.object({
  autoLaunchMinimizedWarned: z.boolean(),
  importWillMoveWarned: z.boolean().optional(),
  lastLoadedModels: z.array(z.string()).optional(),
  autoStartServer: z.boolean().optional(),
  fetchModelCatalog: z.boolean().optional(),
});

export type CliPref = z.infer<typeof cliPrefSchema>;

export async function getCliPref(logger?: SimpleLogger): Promise<SimpleFileData<CliPref>> {
  const defaultCliPref: CliPref = {
    autoLaunchMinimizedWarned: false,
    importWillMoveWarned: false,
    lastLoadedModels: [],
    autoStartServer: undefined,
    fetchModelCatalog: undefined,
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
