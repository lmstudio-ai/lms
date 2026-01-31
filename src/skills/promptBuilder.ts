import type { DiscoveredSkill } from "./types.js";

/**
 * Build an XML block describing available skills for injection into the system prompt.
 *
 * Follows the recommended Agent Skills integration format:
 * https://agentskills.io/integrate-skills
 */
export function buildSkillsPromptXml(skills: DiscoveredSkill[]): string {
  if (skills.length === 0) return "";

  const entries = skills
    .map(
      s =>
        `  <skill>\n` +
        `    <name>${escapeXml(s.metadata.name)}</name>\n` +
        `    <description>${escapeXml(s.metadata.description)}</description>\n` +
        `    <location>${escapeXml(s.skillMdPath)}</location>\n` +
        `  </skill>`,
    )
    .join("\n");

  return `<available_skills>\n${entries}\n</available_skills>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
