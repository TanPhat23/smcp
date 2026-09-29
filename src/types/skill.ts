import { z } from "zod";

export const SkillEntrySchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, "Skill name must be alphanumeric slug"),
  path: z.string(),
  description: z.string().optional(),
  contentHash: z.string().optional(),
  files: z.record(z.string(), z.string()).optional() // filename -> content when bundled in Gist
});

export type SkillEntry = z.infer<typeof SkillEntrySchema>;
