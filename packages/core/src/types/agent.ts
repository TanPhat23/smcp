import { z } from "zod";

export const AgentProfileSchema = z.object({
  name: z.string(),
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
