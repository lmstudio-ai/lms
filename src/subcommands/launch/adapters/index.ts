import { type ToolAdapter } from "../types.js";
import { aider } from "./aider.js";
import { claude } from "./claude.js";
import { codex } from "./codex.js";
import { copilot } from "./copilot.js";
import { droid } from "./droid.js";
import { opencode } from "./opencode.js";

export const adapters: ToolAdapter[] = [claude, codex, copilot, aider, opencode, droid];
