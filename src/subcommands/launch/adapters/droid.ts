import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { exists } from "../../../exists.js";
import { runPromptWithExitHandling } from "../../../prompt.js";
import { UserInputError } from "../../../types/UserInputError.js";
import { type ToolAdapter } from "../types.js";

const COMMAND = "droid";
// Stable key so re-running "lms launch droid" updates the same entry instead of duplicating it.
const DISPLAY_NAME = "LM Studio (lms launch)";

export interface DroidCustomModel {
  displayName: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  provider: string;
}

export interface DroidSettings {
  customModels?: DroidCustomModel[];
  [key: string]: unknown;
}

function settingsFilePath(): string {
  return join(homedir(), ".factory", "settings.json");
}

/** Exported for unit testing; merges idempotently by `displayName` (last write wins). */
export function mergeDroidSettings(existing: DroidSettings, entry: DroidCustomModel): DroidSettings {
  const customModels = (existing.customModels ?? []).filter(
    model => model.displayName !== entry.displayName,
  );
  customModels.push(entry);
  return { ...existing, customModels };
}

/**
 * Factory's `droid` CLI. Model selection lives in `~/.factory/settings.json`, a real file the
 * user's Factory installation also reads/writes, so we back up the original content, write our
 * entry keyed by a stable displayName (idempotent across re-runs), confirm before touching it
 * unless -y, and restore the original content on exit via `cleanup` (kept in place under
 * `--print-env`, where the emitted command still needs it).
 *
 * Factory's BYOK schema has no context-window field (only `maxOutputTokens`, the completion cap),
 * so this adapter conveys no context hint -- `supportsContextHint` is false and the model's loaded
 * window is simply the effective one.
 */
export const droid: ToolAdapter = {
  name: "droid",
  displayName: "Factory (droid)",
  command: COMMAND,
  install: { note: "Install the Factory CLI (droid) from your Factory account/dashboard." },
  supportsContextHint: false,
  async prepare(ctx) {
    const filePath = settingsFilePath();
    const fileExisted = await exists(filePath);
    const originalRaw = fileExisted ? await readFile(filePath, "utf-8") : undefined;

    let existingSettings: DroidSettings = {};
    if (originalRaw !== undefined) {
      try {
        existingSettings = JSON.parse(originalRaw) as DroidSettings;
      } catch {
        throw new UserInputError(
          `Could not parse ${filePath} as JSON. Please fix or remove the file, then try again.`,
        );
      }
    }

    const entry: DroidCustomModel = {
      displayName: DISPLAY_NAME,
      model: ctx.model,
      baseUrl: ctx.openaiBaseUrl,
      apiKey: ctx.apiKey,
      provider: "generic-chat-completion-api",
    };
    // Deliberately no maxOutputTokens: it is Factory's output-completion cap, not a context-window
    // hint, so mapping the model's context length onto it would advertise a bogus response budget.

    if (!ctx.yes && process.stdin.isTTY === true) {
      console.info();
      console.info(chalk.dim(`! "droid" reads its model list from ${filePath}.`));
      const proceed = await runPromptWithExitHandling(() =>
        confirm(
          { message: `Add/update the "${DISPLAY_NAME}" entry in ${filePath}?`, default: true },
          { output: process.stderr },
        ),
      );
      if (!proceed) {
        throw new UserInputError(`Aborted: declined to modify ${filePath}.`);
      }
    }

    const merged = mergeDroidSettings(existingSettings, entry);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(merged, null, 2), "utf-8");

    const cleanup = async () => {
      if (originalRaw !== undefined) {
        await writeFile(filePath, originalRaw, "utf-8");
      } else {
        await rm(filePath, { force: true });
      }
    };

    return {
      command: COMMAND,
      args: [],
      env: {},
      notes: [
        ctx.printEnv
          ? `Wrote a "${DISPLAY_NAME}" entry to ${filePath} and left it in place so the printed ` +
            `command resolves the model; it is NOT auto-reverted. Remove it yourself, or re-run ` +
            `without --print-env to have it reverted on exit.`
          : `Wrote a temporary "${DISPLAY_NAME}" entry to ${filePath}; it will be reverted on exit.`,
      ],
      cleanup,
    };
  },
};
