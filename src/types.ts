import { z } from "zod";

export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const McpServerConfigSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().url().optional()
  })
  .passthrough();

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
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  version: z.string().regex(SEMVER_REGEX),
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
  mcpConfig: z
    .object({
      paths: z.array(z.string()),
      key: z.string().default("mcpServers")
    })
    .nullable()
    .optional(),
  skills: z
    .object({
      paths: z.array(z.string())
    })
    .nullable()
    .optional()
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const DetectedAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mcpConfigPath: z.string().nullable(),
  skillsDirPath: z.string().nullable()
});

export type DetectedAgent = z.infer<typeof DetectedAgentSchema>;

export const ShareRecordSchema = z.object({
  name: z.string(),
  version: z.string().regex(SEMVER_REGEX),
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

export const AuthConfigSchema = z.object({
  githubToken: z.string().optional(),
  githubUser: z.string().optional()
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

