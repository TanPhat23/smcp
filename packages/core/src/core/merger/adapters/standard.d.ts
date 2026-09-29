import type { McpAdapter, McpAdapterContext, McpServerConfig } from "../../../types/index.ts";
/**
 * Standard MCP Adapter (Claude Code, Cursor, Windsurf, Claude Desktop).
 * Emits canonical format:
 * - command: string
 * - args: string[]
 * - env: Record<string, string>
 * - url?: string
 */
export declare class StandardMcpAdapter implements McpAdapter {
    readonly name = "standard";
    matches(_context?: McpAdapterContext): boolean;
    serialize(serverConfig: McpServerConfig, _context: McpAdapterContext, existingServer?: unknown): Record<string, unknown>;
    deserialize(rawConfig: Record<string, unknown>, _context?: McpAdapterContext): McpServerConfig;
}
