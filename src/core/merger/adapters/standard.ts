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

/**
 * Standard MCP Adapter (Claude Code, Cursor, Windsurf, Claude Desktop).
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

    // If command was an array (e.g. from OpenCode export), normalize to command string + args array
    if (Array.isArray(cleanedConfig.command)) {
      const cmdArr = (cleanedConfig.command as unknown[]).filter(
        (c) => c !== null && c !== undefined && typeof c !== "object"
      );
      formatted.command = cmdArr.length > 0 ? String(cmdArr[0]) : "";
      if (cmdArr.length > 1) {
        formatted.args = cmdArr.slice(1).map(String);
      }
    } else if (Array.isArray(cleanedConfig.args)) {
      formatted.args = (cleanedConfig.args as unknown[])
        .filter((a) => a !== null && a !== undefined && typeof a !== "object")
        .map(String);
    }

    // Map OpenCode environment back to env if needed
    const envClean = sanitizeRecord(
      cleanedConfig.env || (cleanedConfig as any).environment || baseExisting.env || (baseExisting as any).environment
    );
    if (envClean) {
      formatted.env = envClean;
    }
    delete formatted.environment;

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
    const result: McpServerConfig = { ...cleaned };

    if (Array.isArray(cleaned.command)) {
      const cmdArr = (cleaned.command as unknown[]).filter(
        (c) => c !== null && c !== undefined && typeof c !== "object"
      );
      result.command = cmdArr.length > 0 ? String(cmdArr[0]) : "";
      if (cmdArr.length > 1) {
        result.args = cmdArr.slice(1).map(String);
      }
    } else if (Array.isArray(cleaned.args)) {
      result.args = (cleaned.args as unknown[])
        .filter((a) => a !== null && a !== undefined && typeof a !== "object")
        .map(String);
    }

    const envClean = sanitizeRecord(cleaned.env || (cleaned as any).environment);
    if (envClean) {
      result.env = envClean;
    }

    return cleanObjectWithoutPrototype(result) as McpServerConfig;
  }
}
