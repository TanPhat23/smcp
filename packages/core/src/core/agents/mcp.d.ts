import type { McpServerConfig } from "../../types/index.ts";
export declare function normalizeMcpServerConfig(raw: Record<string, unknown>): McpServerConfig;
export declare function readInstalledMcpServers(mcpConfigPath: string, key?: string): Record<string, McpServerConfig>;
