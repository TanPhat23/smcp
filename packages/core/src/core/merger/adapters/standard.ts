import type { McpAdapter, McpAdapterContext, McpServerConfig } from "../../../types/index.ts";
import { isPrototypePollutionKey } from "../../../utils/security.ts";

function sanitizeRecord(obj: unknown): Record<string, string> | undefined {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return undefined;
  }
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!isPrototypePollutionKey(k) && v !== undefined && v !== null) {
      clean[k] = String(v);
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function cleanObjectWithoutPrototype(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return {};
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!isPrototypePollutionKey(k)) {
      clean[k] = v;
    }
  }
  return clean;
}

function normalizeCommandAndArgs(
  source: Record<string, unknown>,
  target: Record<string, unknown>
): void {
  if (Array.isArray(source.command)) {
    const cmdArr = source.command.filter(
      (c) => c !== null && c !== undefined && typeof c !== "object"
    );
    target.command = cmdArr.length > 0 ? String(cmdArr[0]) : "";
    if (cmdArr.length > 1) {
      target.args = cmdArr.slice(1).map(String);
    }
  } else if (Array.isArray(source.args)) {
    target.args = source.args
      .filter((a) => a !== null && a !== undefined && typeof a !== "object")
      .map(String);
  }
}

function normalizeRemoteUrl(target: Record<string, unknown>): void {
  const rawAlias =
    typeof target.serverUrl === "string" && target.serverUrl.trim()
      ? target.serverUrl.trim()
      : typeof target.httpUrl === "string" && target.httpUrl.trim()
      ? target.httpUrl.trim()
      : undefined;
  if (rawAlias) {
    if (typeof target.url !== "string" || !target.url.trim()) {
      target.url = rawAlias;
    }
    delete target.serverUrl;
    delete target.httpUrl;
  }
}

/**
 * Standard MCP Adapter (Claude Code, Cursor, Windsurf, Claude Desktop, Antigravity).
 * Emits canonical format:
 * - command: string
 * - args: string[]
 * - env: Record<string, string>
 * - url?: string
 */
export class StandardMcpAdapter implements McpAdapter {
  readonly name = "standard";

  matches(_context?: McpAdapterContext): boolean {
    // Default fallback adapter for all standard MCP-compliant AI agents
    return true;
  }

  serialize(
    serverConfig: McpServerConfig,
    _context: McpAdapterContext,
    existingServer?: unknown
  ): Record<string, unknown> {
    if (!serverConfig || typeof serverConfig !== "object" || Array.isArray(serverConfig)) {
      return {};
    }

    const baseExisting = cleanObjectWithoutPrototype(existingServer);
    const cleanedConfig = cleanObjectWithoutPrototype(serverConfig);

    const formatted: Record<string, unknown> = {
      ...baseExisting,
      ...cleanedConfig
    };

    normalizeCommandAndArgs(cleanedConfig, formatted);
    normalizeRemoteUrl(formatted);

    // Map OpenCode environment back to env if needed
    const envClean = sanitizeRecord(
      cleanedConfig.env || cleanedConfig.environment || baseExisting.env || baseExisting.environment
    );
    if (envClean) {
      formatted.env = envClean;
    }
    delete formatted.environment;

    // Claude Code requires an explicit transport type for URL servers.
    if (
      _context?.agentId === "claude-code" &&
      typeof formatted.url === "string" &&
      formatted.url &&
      formatted.command === undefined &&
      formatted.type === undefined
    ) {
      formatted.type = /\/sse\/?(\?|$)/i.test(formatted.url) ? "sse" : "http";
    }

    return cleanObjectWithoutPrototype(formatted);
  }

  deserialize(
    rawConfig: Record<string, unknown>,
    _context?: McpAdapterContext
  ): McpServerConfig {
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      return {};
    }

    const cleaned = cleanObjectWithoutPrototype(rawConfig);
    const result: Record<string, unknown> = { ...cleaned };

    normalizeCommandAndArgs(cleaned, result);
    normalizeRemoteUrl(result);

    const envClean = sanitizeRecord(cleaned.env || cleaned.environment);
    if (envClean) {
      result.env = envClean;
    }

    return cleanObjectWithoutPrototype(result) as McpServerConfig;
  }
}
