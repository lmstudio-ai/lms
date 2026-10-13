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
 * Exported for unit testing; removes our entry by `displayName`, preserving every other key and
 * custom model. Used on cleanup so settings the droid session changed meanwhile aren't clobbered.
 * Drops the `customModels` key entirely when nothing else is left in it.
 */
export function removeDroidSettingsEntry(
  existing: DroidSettings,
  displayName: string,
): DroidSettings {
  const customModels = (existing.customModels ?? []).filter(
    model => model.displayName !== displayName,
  );
  const result: DroidSettings = { ...existing };
  if (customModels.length > 0) {
    result.customModels = customModels;
  } else {
    delete result.customModels;
  }
  return result;
}

/**
 * Factory's `droid` CLI. Model selection lives in `~/.factory/settings.json`, a real file the
 * user's Factory installation also reads/writes, so we back up the original content, write our
 * entry keyed by a stable displayName (idempotent across re-runs), confirm before touching it
 * unless -y, and on exit `cleanup` removes only our entry from the current file -- preserving any
 * settings the droid session changed meanwhile (kept in place under `--print-env`, where the
 * emitted command still needs it).
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

    if (ctx.dryRun) {
      // A dry run must be side-effect-free: describe the plan without touching the real settings
      // file, without prompting, and without failing in a non-TTY shell for lack of -y.
      return {
        command: COMMAND,
        args: [],
        env: {},
        notes: [
          `Would write a "${DISPLAY_NAME}" entry to ${filePath} (reverted on exit); once launched, ` +
            `run "/model" inside droid and choose "${DISPLAY_NAME}".`,
        ],
      };
    }

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

    // Capture any pre-existing entry with our displayName (e.g. one an earlier --print-env run left
    // in place). prepare() below overwrites it; cleanup must restore *this* value, not delete it.
    const originalEntry = existingSettings.customModels?.find(
      model => model.displayName === DISPLAY_NAME,
    );

    const entry: DroidCustomModel = {
      displayName: DISPLAY_NAME,
      model: ctx.model,
      baseUrl: ctx.openaiBaseUrl,
      apiKey: ctx.apiKey,
      provider: "generic-chat-completion-api",
    };
    // Deliberately no maxOutputTokens: it is Factory's output-completion cap, not a context-window
    // hint, so mapping the model's context length onto it would advertise a bogus response budget.

    if (!ctx.yes) {
      if (process.stdin.isTTY !== true) {
        // No TTY means we cannot prompt. Rewriting a real user file -- one that --print-env
        // deliberately leaves in place (un-reverted) -- must not happen without explicit consent,
        // so fail here instead of silently proceeding as if --yes had been passed.
        throw new UserInputError(
          `Launching "droid" adds a custom model entry to ${filePath}. In a non-interactive shell ` +
            `there is no way to confirm; re-run with -y/--yes to approve modifying it, or run in an ` +
            `interactive terminal.`,
        );
      }
      // Prompt context goes to stderr (like the confirm prompt below), so it never lands on stdout
      // where `eval "$(lms launch droid --print-env)"` would try to run this human text as shell.
      console.error();
      console.error(chalk.dim(`! "droid" reads its model list from ${filePath}.`));
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
      // droid (or the user) may edit ~/.factory/settings.json while the session runs, so re-read the
      // CURRENT file and strip only our entry -- writing the whole pre-launch snapshot back would
      // clobber those unrelated changes. Fall back to the snapshot only if the file is now
      // missing/unparseable, where surgical removal isn't possible.
      let current: DroidSettings | undefined;
      try {
        current = JSON.parse(await readFile(filePath, "utf-8")) as DroidSettings;
      } catch {
        current = undefined;
      }
      if (current === undefined) {
        if (originalRaw !== undefined) {
          await writeFile(filePath, originalRaw, "utf-8");
        } else {
          await rm(filePath, { force: true });
        }
        return;
      }
      const withoutOurs = removeDroidSettingsEntry(current, DISPLAY_NAME);
      // If the entry pre-existed this launch, restore the user's original value instead of deleting
      // it along with our launch-time overwrite; otherwise just drop the entry we added.
      const cleaned =
        originalEntry !== undefined ? mergeDroidSettings(withoutOurs, originalEntry) : withoutOurs;
      if (originalRaw === undefined && Object.keys(cleaned).length === 0) {
        // We created the file and nothing else remains -- leave no trace.
        await rm(filePath, { force: true });
      } else {
        await writeFile(filePath, JSON.stringify(cleaned, null, 2), "utf-8");
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
        // droid isn't pointed at the entry automatically: it keeps its current default model, and
        // its "--model" flag does not reliably accept custom BYOK models yet (Factory-AI/factory
        // #787), so injecting one risks an "Invalid model" failure. Selection is via "/model".
        `To use it, run "/model" inside droid and choose "${DISPLAY_NAME}".`,
      ],
      cleanup,
    };
  },
};
