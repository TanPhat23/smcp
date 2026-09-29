import { z } from "zod";
export declare const McpServerConfigSchema: z.ZodObject<{
    command: z.ZodOptional<z.ZodString>;
    args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    url: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    command: z.ZodOptional<z.ZodString>;
    args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    url: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    command: z.ZodOptional<z.ZodString>;
    args: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    url: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
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
    serialize(serverConfig: McpServerConfig, context: McpAdapterContext, existingServer?: unknown): Record<string, unknown>;
    deserialize(rawConfig: Record<string, unknown>, context?: McpAdapterContext): McpServerConfig;
}
