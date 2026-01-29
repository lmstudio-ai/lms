import { type SimpleLogger } from "@lmstudio/lms-common";
import { existsSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { parseSkillMd } from "./parser.js";
import type { DiscoveredSkill } from "./types.js";

/**
 * Scan the given directories for valid Agent Skills (folders containing a SKILL.md file).
 *
 * Skills where the `name` field doesn't match the directory name are skipped.
 * Inaccessible directories or invalid skills are silently skipped.
 */
export async function discoverSkills(
  directories: string[],
  logger?: SimpleLogger,
): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = [];

  for (const dir of directories) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      logger?.debug(`Skills directory not accessible: ${dir}`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = join(dir, entry.name);
      const skillMdPath = join(skillDir, "SKILL.md");

      if (!existsSync(skillMdPath)) continue;

      try {
        const content = await readFile(skillMdPath, "utf-8");
        const { metadata, body } = parseSkillMd(content);

        // Spec requires name to match parent directory name
        if (metadata.name !== entry.name) {
          logger?.debug(
            `Skill name "${metadata.name}" does not match directory "${entry.name}", skipping`,
          );
          continue;
        }

        skills.push({
          metadata,
          path: skillDir,
          skillMdPath,
          body,
          hasScripts: existsSync(join(skillDir, "scripts")),
          hasReferences: existsSync(join(skillDir, "references")),
          hasAssets: existsSync(join(skillDir, "assets")),
        });
      } catch (error) {
        logger?.debug(`Failed to parse skill at ${skillDir}:`, error);
      }
    }
  }

  return skills;
}
