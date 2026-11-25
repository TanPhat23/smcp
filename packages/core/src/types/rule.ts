import { z } from "zod";

export const RuleEntrySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    contentHash: z.string().optional(),
    content: z.string().optional(),
    files: z.record(z.string(), z.string()).optional()
  })
  .passthrough();

export type RuleEntry = z.infer<typeof RuleEntrySchema>;
