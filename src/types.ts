import { z } from "zod";

export const McpServerConfigSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().url().optional()
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const SkillEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  description: z.string().optional(),
  contentHash: z.string().optional(),
  files: z.record(z.string(), z.string()).optional() // filename -> content when bundled in Gist
});

export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export const RequiredEnvSchema = z.object({
  key: z.string(),
  description: z.string().optional(),
  isSecret: z.boolean().default(true)
});

export type RequiredEnv = z.infer<typeof RequiredEnvSchema>;

export const ManifestSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().optional(),
  author: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional().default({}),
  skills: z.array(SkillEntrySchema).optional().default([]),
  requiredEnv: z.array(RequiredEnvSchema).optional().default([])
});

export type Manifest = z.infer<typeof ManifestSchema>;

export const AgentProfileSchema = z.object({
  name: z.string(),
  mcpConfig: z.object({
    paths: z.array(z.string()),
    key: z.string().default("mcpServers")
  }).nullable().optional(),
  skills: z.object({
    paths: z.array(z.string())
  }).nullable().optional()
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const ShareRecordSchema = z.object({
  name: z.string(),
  version: z.string(),
  targetType: z.enum(["gist", "repo", "local"]),
  targetUrl: z.string(),
  gistId: z.string().optional(),
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

export interface AuthConfig {
  githubToken?: string;
  githubUser?: string;
}
