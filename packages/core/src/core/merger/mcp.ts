import fs from "node:fs";
import type { McpServerConfig } from "../../types/index.ts";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { stripJsonComments } from "../agents/index.ts";
import { getMcpAdapter, StandardMcpAdapter } from "./adapters/index.ts";

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
export function formatServerForAgent(
  serverConfig: McpServerConfig,
  targetKey: string,
  filePath: string,
  existingServer?: unknown,
  formatOrAgentId?: string
): Record<string, unknown> {
  const context = {
    filePath,
    targetKey,
    format: formatOrAgentId,
    agentId: formatOrAgentId
  };
  const adapter = getMcpAdapter(context);

  try {
    return adapter.serialize(serverConfig, context, existingServer);
  } catch {
    const fallback = new StandardMcpAdapter();
    return fallback.serialize(serverConfig, context, existingServer);
  }
}

export function mergeMcpServersIntoFile(
  filePath: string,
  newServers: Record<string, McpServerConfig>,
  mcpKeyOrOptions: string | MergeMcpServersOptions = "mcpServers"
): void {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid filePath: must be a non-empty string");
  }

  const options: MergeMcpServersOptions =
    typeof mcpKeyOrOptions === "string"
      ? { mcpKey: mcpKeyOrOptions }
      : mcpKeyOrOptions || {};

  const mcpKey = options.mcpKey || "mcpServers";

  if (!mcpKey || typeof mcpKey !== "string" || isPrototypePollutionKey(mcpKey)) {
    throw new Error(`Invalid mcpKey: ${mcpKey}`);
  }

  if (options.format && (typeof options.format !== "string" || isPrototypePollutionKey(options.format))) {
    throw new Error(`Invalid format: ${String(options.format)}`);
  }

  if (options.agentId && (typeof options.agentId !== "string" || isPrototypePollutionKey(options.agentId))) {
    throw new Error(`Invalid agentId: ${String(options.agentId)}`);
  }

  const resolvedPath = expandHome(filePath);
  let writePath = resolvedPath;

  let config: Record<string, unknown> = {};
  if (fs.existsSync(resolvedPath)) {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Target path is not a file: ${resolvedPath}`);
    }
    writePath = fs.realpathSync(resolvedPath);

    let raw = "";
    try {
      raw = fs.readFileSync(writePath, "utf8");
      const parsed = JSON.parse(stripJsonComments(raw));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed;
      }
    } catch {
      if (raw.trim().length > 0) {
        const backupPath = `${resolvedPath}.bak.${Date.now()}`;
        fs.writeFileSync(backupPath, raw, "utf8");
        console.warn(`Warning: Corrupted config at ${resolvedPath} was backed up to ${backupPath}`);
      }
      config = {};
    }
  }

  if (Object.hasOwn(config, "__proto__")) delete (config as any)["__proto__"];
  if (Object.hasOwn(config, "constructor")) delete (config as any)["constructor"];
  if (Object.hasOwn(config, "prototype")) delete (config as any)["prototype"];

  let targetKey = mcpKey;
  if (
    !config[targetKey] &&
    mcpKey === "mcpServers" &&
    config.mcp &&
    typeof config.mcp === "object" &&
    !Array.isArray(config.mcp)
  ) {
    targetKey = "mcp";
  }

  const existingServers = config[targetKey];
  let serversMap: Record<string, unknown>;

  if (
    existingServers &&
    typeof existingServers === "object" &&
    !Array.isArray(existingServers)
  ) {
    serversMap = existingServers as Record<string, unknown>;
    if (Object.hasOwn(serversMap, "__proto__")) delete (serversMap as any)["__proto__"];
    if (Object.hasOwn(serversMap, "constructor")) delete (serversMap as any)["constructor"];
    if (Object.hasOwn(serversMap, "prototype")) delete (serversMap as any)["prototype"];
  } else {
    serversMap = {};
    config[targetKey] = serversMap;
  }

  if (newServers && typeof newServers === "object" && !Array.isArray(newServers)) {
    for (const [serverName, serverConfig] of Object.entries(newServers)) {
      if (isPrototypePollutionKey(serverName)) {
        continue;
      }
      const existing = serversMap[serverName];
      const context = {
        filePath: writePath,
        targetKey,
        format: options.format,
        agentId: options.agentId
      };
      const adapter = getMcpAdapter(context);

      try {
        serversMap[serverName] = adapter.serialize(
          serverConfig,
          context,
          existing
        );
      } catch {
        const fallback = new StandardMcpAdapter();
        serversMap[serverName] = fallback.serialize(
          serverConfig,
          context,
          existing
        );
      }
    }
  }

  const content = JSON.stringify(config, null, 2) + "\n";
  atomicWriteFileSync(writePath, content);
}
