import { z } from "zod";
import { SEMVER_REGEX } from "./common.ts";

export const ShareRecordSchema = z.object({
  name: z.string(),
  version: z.string().regex(SEMVER_REGEX),
  targetType: z.enum(["gist", "repo", "local"]),
  targetUrl: z.string(),
  gistId: z.string().optional(),
  repoFullName: z.string().optional(),
  lastSharedAt: z.string(),
  fingerprints: z.object({
    mcpServers: z.record(z.string(), z.string()).default({}),
    skills: z.record(z.string(), z.string()).default({})
  })
});

export type ShareRecord = z.infer<typeof ShareRecordSchema>;

export const ShareHistorySchema = z.object({
  shares: z.array(ShareRecordSchema).default([])
});

export type ShareHistory = z.infer<typeof ShareHistorySchema>;
