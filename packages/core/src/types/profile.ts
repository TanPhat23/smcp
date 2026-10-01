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
    .optional(),
  agents: z
    .object({
      paths: z.array(z.string()),
      format: z.string().optional()
    })
    .nullable()
    .optional()
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;
