import { z } from "zod";

/**
 * Agent Skills specification: https://agentskills.io/specification
 *
 * Name must be 1-64 characters, lowercase alphanumeric + hyphens,
 * no leading/trailing/consecutive hyphens, must match parent directory name.
 */
const skillNameRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export const skillMetadataSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(skillNameRegex, "Must be lowercase letters, numbers, and hyphens only")
    .refine((s: string) => !s.includes("--"), "Must not contain consecutive hyphens"),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  "allowed-tools": z.string().optional(),
});

export type SkillMetadata = z.infer<typeof skillMetadataSchema>;

export interface DiscoveredSkill {
  metadata: SkillMetadata;
  /** Absolute path to skill directory */
  path: string;
  /** Absolute path to SKILL.md */
  skillMdPath: string;
  /** Markdown body content */
  body: string;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}
