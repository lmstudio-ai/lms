import YAML from "yaml";
import { skillMetadataSchema, type SkillMetadata } from "./types.js";

export interface ParsedSkillMd {
  metadata: SkillMetadata;
  body: string;
}

/**
 * Parse a SKILL.md file's content into metadata (from YAML frontmatter) and body (Markdown).
 *
 * The file must start with `---` followed by YAML frontmatter and closed with `---`.
 */
export function parseSkillMd(content: string): ParsedSkillMd {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("SKILL.md must contain YAML frontmatter between --- markers");
  }
  const [, frontmatterRaw, body] = match;
  const parsed = YAML.parse(frontmatterRaw);
  const metadata = skillMetadataSchema.parse(parsed);
  return { metadata, body: body.trim() };
}

/**
 * Parse only the metadata (frontmatter) from a SKILL.md file, without fully loading the body.
 * Used for lightweight discovery where we only need name + description.
 */
export function parseSkillMetadataOnly(content: string): SkillMetadata {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error("SKILL.md must contain YAML frontmatter between --- markers");
  }
  const [, frontmatterRaw] = match;
  const parsed = YAML.parse(frontmatterRaw);
  return skillMetadataSchema.parse(parsed);
}
