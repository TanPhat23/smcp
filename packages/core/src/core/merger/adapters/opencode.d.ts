import type { McpAdapter, McpAdapterContext, McpServerConfig } from "../../../types/index.ts";
/**
 * MCP Adapter for OpenCode (opencode.json / opencode.jsonc).
 * Enforces OpenCode schema:
 * - Local: type: "local", command: string[], enabled: true, environment?: object
 * - Remote: type: "remote", url: string, enabled: true, headers?: object
 */
export declare class OpenCodeMcpAdapter implements McpAdapter {
    readonly name = "opencode";
    matches(context?: McpAdapterContext): boolean;
    serialize(serverConfig: McpServerConfig, _context: McpAdapterContext, existingServer?: unknown): Record<string, unknown>;
    deserialize(rawConfig: Record<string, unknown>, _context?: McpAdapterContext): McpServerConfig;
}
