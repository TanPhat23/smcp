import { z } from "zod";

export const AgentProfileSchema = z.object({
  name: z.string().trim().min(1, "Agent name must be a non-empty string"),
  mcpConfig: z
    .object({
      paths: z.array(z.string()),
      key: z.string().default("mcpServers"),
      format: z.string().optional()
    })
    .nullable()
    .optional(),
  skills: z
    .object({
      paths: z.array(z.string())
    })
    .nullable()
    .optional(),
  plugins: z
    .object({
      paths: z.array(z.string()),
      key: z.string().default("plugin"),
      format: z.enum(["array", "map"]).default("array"),
      dirPaths: z.array(z.string()).optional()
    })
    .nullable()
    .optional()
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const DetectedAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mcpConfigPath: z.string().nullable(),
  skillsDirPath: z.string().nullable(),
  pluginsConfigPath: z.string().nullable().optional(),
  pluginsDirPath: z.string().nullable().optional()
});

export type DetectedAgent = z.infer<typeof DetectedAgentSchema>;

export const AgentToolsSchema = z.union([
  z.array(z.string()),
  z.object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional()
  })
]);

export const UniversalAgentFrontmatterSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9_-]+$/, "Name must be alphanumeric, hyphen, or underscore"),
    description: z.string().min(1, "Description is required"),
    mode: z.enum(["subagent", "primary", "all"]).optional().default("subagent"),
    model: z.string().optional(),
    temperature: z.number().optional(),
    tools: AgentToolsSchema.optional(),
    skills: z.array(z.string()).optional().default([]),
    codex: z.record(z.string(), z.unknown()).optional(),
    opencode: z.record(z.string(), z.unknown()).optional(),
    claude: z.record(z.string(), z.unknown()).optional(),
    cursor: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export type UniversalAgentFrontmatter = z.infer<typeof UniversalAgentFrontmatterSchema>;

export interface UniversalAgent extends UniversalAgentFrontmatter {
  prompt: string;
}

export const AgentEntrySchema = z
  .object({
    name: z.string(),
    path: z.string().optional(),
    description: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]).optional(),
    model: z.string().optional()
  })
  .passthrough();

export type AgentEntry = z.infer<typeof AgentEntrySchema>;

export interface CompiledAgentFile {
  filename: string;
  content: string;
}


