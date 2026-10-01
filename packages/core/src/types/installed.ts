import { z } from "zod";

export const InstalledPackRecordSchema = z.object({
  name: z.string(),
  source: z.string(),
  version: z.string(),
  targetAgents: z.array(z.string()).default([]),
  runtime: z.string().optional(),
  installedMcp: z.array(z.string()).default([]),
  installedSkills: z.array(z.string()).default([]),
  installedPlugins: z.array(z.string()).default([]),
  envKeys: z.array(z.string()).optional().default([]),
  installedAt: z.string(),
  updatedAt: z.string().optional()
});

export type InstalledPackRecord = z.infer<typeof InstalledPackRecordSchema>;

export const InstalledPacksRegistrySchema = z.record(z.string(), InstalledPackRecordSchema);

export type InstalledPacksRegistry = z.infer<typeof InstalledPacksRegistrySchema>;
