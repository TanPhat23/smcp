import { z } from "zod";
import { SEMVER_REGEX } from "./common.ts";
import { McpServerConfigSchema, type McpServerConfig } from "./mcp.ts";
import { SkillEntrySchema, type SkillEntry } from "./skill.ts";
import { PluginEntrySchema, type PluginEntry } from "./plugin.ts";
import { RequiredEnvSchema, type RequiredEnv } from "./env.ts";

export const ManifestSchema = z
  .object({
    $schema: z.string().optional(),
    name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    version: z.string().regex(SEMVER_REGEX),
    description: z.string().optional(),
    author: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    mcpServers: z.record(z.string(), McpServerConfigSchema).optional().default({}),
    skills: z.array(SkillEntrySchema).optional().default([]),
    plugins: z.array(PluginEntrySchema).optional().default([]),
    requiredEnv: z.array(RequiredEnvSchema).optional().default([])
  })
  .passthrough();

export interface Manifest {
  $schema?: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  mcpServers?: Record<string, McpServerConfig>;
  skills?: SkillEntry[];
  plugins?: PluginEntry[];
  requiredEnv?: RequiredEnv[];
  [key: string]: unknown;
}
