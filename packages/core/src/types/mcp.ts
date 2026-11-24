import { z } from "zod";

export const McpServerConfigSchema = z
  .object({
    command: z.union([z.string(), z.array(z.string())]).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.unknown()).optional(),
    type: z.string().optional(),
    disabled: z.boolean().optional(),
    enabled: z.boolean().optional()
  })
  .passthrough();

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export interface McpAdapterContext {
  filePath?: string;
  targetKey?: string;
  agentId?: string;
  format?: string;
}

export interface McpAdapter {
  name: string;
  matches(context: McpAdapterContext): boolean;
  serialize(
    serverConfig: McpServerConfig,
    context: McpAdapterContext,
    existingServer?: unknown
  ): Record<string, unknown>;
  deserialize(
    rawConfig: Record<string, unknown>,
    context?: McpAdapterContext
  ): McpServerConfig;
}
