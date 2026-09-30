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
 * MCP Adapter for OpenCode (opencode.json / opencode.jsonc).
 * Enforces OpenCode schema:
 * - Local: type: "local", command: string[], enabled: true, environment?: object
 * - Remote: type: "remote", url: string, enabled: true, headers?: object
 */
export class OpenCodeMcpAdapter implements McpAdapter {
  readonly name = "opencode";

  matches(context?: McpAdapterContext): boolean {
    if (!context || typeof context !== "object") {
      return false;
    }
    if (context.format === "opencode") {
      return true;
    }
    if (context.agentId === "opencode" || context.agentId?.includes("opencode")) {
      return true;
    }
    if (context.targetKey === "mcp") {
      return true;
    }
    if (context.targetKey === "mcpServers") {
      return false;
    }
    if (context.filePath && /opencode\.jsonc?$/i.test(context.filePath)) {
      return true;
    }
    return false;
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

    // Remote server configuration
    if (typeof serverConfig.url === "string" && serverConfig.url.trim().length > 0) {
      const remoteConfig: Record<string, unknown> = {
        type: "remote",
        url: serverConfig.url.trim(),
        ...baseExisting
      };

      const headers = sanitizeRecord(serverConfig.headers || baseExisting.headers);
      if (headers) {
        remoteConfig.headers = headers;
      }

      if (serverConfig.oauth !== undefined) {
        remoteConfig.oauth = serverConfig.oauth;
      }

      if (serverConfig.timeout !== undefined) {
        remoteConfig.timeout = serverConfig.timeout;
      }

      if (serverConfig.codemode !== undefined) {
        remoteConfig.codemode = serverConfig.codemode;
      }

      if (
        serverConfig.disabled === true ||
        serverConfig.enabled === false ||
        baseExisting.disabled === true
      ) {
        remoteConfig.disabled = true;
        delete remoteConfig.enabled;
      } else {
        if (serverConfig.disabled === false) {
          delete remoteConfig.disabled;
        }
        remoteConfig.enabled = true;
      }

      delete remoteConfig.command;
      delete remoteConfig.args;
      delete remoteConfig.env;
      delete remoteConfig.environment;
      if (_context?.agentId === "opencode") {
        delete remoteConfig.enabled;
      } else {
        remoteConfig.enabled = true;
      }

      return cleanObjectWithoutPrototype(remoteConfig);
    }

    // Local process configuration
    const cmdArray: string[] = [];
    if (Array.isArray(serverConfig.command)) {
      for (const item of serverConfig.command) {
        if (item !== null && item !== undefined && typeof item !== "object") {
          cmdArray.push(String(item));
        }
      }
    } else if (typeof serverConfig.command === "string" && serverConfig.command.trim()) {
      const trimmedCmd = serverConfig.command.trim();
      if (Array.isArray(serverConfig.args) && serverConfig.args.length > 0) {
        cmdArray.push(trimmedCmd);
        for (const arg of serverConfig.args) {
          if (arg !== null && arg !== undefined && typeof arg !== "object") {
            cmdArray.push(String(arg));
          }
        }
      } else {
        const tokens = trimmedCmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [trimmedCmd];
        for (const token of tokens) {
          cmdArray.push(token.replace(/^["']|["']$/g, ""));
        }
      }
    }

    const localConfig: Record<string, unknown> = {
      type: "local",
      command:
        cmdArray.length > 0
          ? cmdArray
          : Array.isArray(baseExisting.command)
            ? (baseExisting.command as unknown[]).map(String)
            : [],
      ...baseExisting
    };

    if (cmdArray.length > 0) {
      localConfig.command = cmdArray;
    }

    const envData = sanitizeRecord(
      serverConfig.env || (serverConfig as any).environment || baseExisting.environment
    );
    if (envData) {
      localConfig.environment = envData;
    }

    if (typeof serverConfig.cwd === "string" && serverConfig.cwd.trim()) {
      localConfig.cwd = serverConfig.cwd.trim();
    }

    if (serverConfig.timeout !== undefined) {
      localConfig.timeout = serverConfig.timeout;
    }

    if (serverConfig.codemode !== undefined) {
      localConfig.codemode = serverConfig.codemode;
    }

    if (
      serverConfig.disabled === true ||
      serverConfig.enabled === false ||
      baseExisting.disabled === true
    ) {
      localConfig.disabled = true;
      delete localConfig.enabled;
    } else {
      if (serverConfig.disabled === false) {
        delete localConfig.disabled;
      }
      localConfig.enabled = true;
    }

    delete localConfig.args;
    delete localConfig.env;
    delete localConfig.url;

    if (_context?.agentId === "opencode") {
      delete localConfig.enabled;
    } else {
      localConfig.enabled = true;
    }

    return cleanObjectWithoutPrototype(localConfig);
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
    }

    const envClean = sanitizeRecord(cleaned.environment || cleaned.env);
    if (envClean) {
      result.env = envClean;
    }

    if (cleaned.disabled === true) {
      result.disabled = true;
      result.enabled = false;
    }

    return cleanObjectWithoutPrototype(result) as McpServerConfig;
  }
}
