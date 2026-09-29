import type { McpServerConfig, RedactorOptions, RequiredEnv } from "../../types/index.ts";
/**
 * Scans and redacts sensitive credentials inside MCP server configurations.
 * Inspects `env`, `args`, `command` (both string and array formats), and `url` fields.
 * Replaces detected secrets with `${VARIABLE_NAME}` environment placeholders
 * and compiles the corresponding list of `requiredEnv` definitions.
 *
 * @param servers - Dictionary of MCP server configurations.
 * @param options - Optional pattern detection overrides and filters.
 * @returns Redacted configurations and compiled requiredEnv definitions.
 */
export declare function redactMcpServers(servers: Record<string, McpServerConfig>, options?: RedactorOptions): {
    redactedServers: Record<string, McpServerConfig>;
    requiredEnv: RequiredEnv[];
};
