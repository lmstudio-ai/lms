import { findLMStudioHome } from "@lmstudio/lms-common-server";
import { join } from "path";

export const lmstudioHome = findLMStudioHome();
export const pluginsFolderPath = join(lmstudioHome, "extensions", "plugins");
export const cliPrefPath = join(lmstudioHome, ".internal", "cli-pref.json");
export const appInstallLocationFilePath = join(
  lmstudioHome,
  ".internal",
  "app-install-location.json",
);
export const llmsterInstallLocationFilePath = join(
  lmstudioHome,
  ".internal",
  "llmster-install-location.json",
);
export const defaultModelsFolder = join(lmstudioHome, "models");
export const serverCtlPath = join(lmstudioHome, ".internal", "http-server-ctl.json");
export const apiServerInfoPath = join(lmstudioHome, ".internal", "http-server.json");
