import type { McpServerConfig } from "../../types/index.ts";
export interface MergeMcpServersOptions {
    mcpKey?: string;
    format?: string;
    agentId?: string;
}
/**
 * Normalizes an MCP server configuration for a specific target agent.
 * Delegates to the registered McpAdapter strategy matching the context,
 * with resilient fallback to StandardMcpAdapter if custom serialization throws.
 */
export declare function formatServerForAgent(serverConfig: McpServerConfig, targetKey: string, filePath: string, existingServer?: unknown, formatOrAgentId?: string): Record<string, unknown>;
export declare function mergeMcpServersIntoFile(filePath: string, newServers: Record<string, McpServerConfig>, mcpKeyOrOptions?: string | MergeMcpServersOptions): void;
