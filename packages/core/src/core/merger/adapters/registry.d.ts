import type { McpAdapter, McpAdapterContext } from "../../../types/index.ts";
/**
 * Registers a new MCP adapter for custom agent formats.
 * User-registered adapters take precedence over built-in adapters.
 */
export declare function registerMcpAdapter(adapter: McpAdapter, prepend?: boolean): void;
/**
 * Unregisters an MCP adapter by name.
 */
export declare function unregisterMcpAdapter(name: string): boolean;
/**
 * Returns a defensive read-only snapshot of all active MCP adapters.
 */
export declare function getAllMcpAdapters(): readonly McpAdapter[];
/**
 * Resets all active MCP adapters to the default built-ins.
 */
export declare function resetMcpAdapters(): void;
/**
 * Resolves the appropriate MCP adapter for a given format name or context.
 * If a name is passed, resolves by exact name match.
 * If a context is passed, safely evaluates `adapter.matches(context)`.
 * Falls back to a guaranteed instance of StandardMcpAdapter.
 */
export declare function getMcpAdapter(nameOrContext?: string | McpAdapterContext): McpAdapter;
