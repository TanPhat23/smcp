import fs from "node:fs";
import os from "node:os";
import type { McpServerConfig } from "../../types/index.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { stripJsonComments } from "./jsonc.ts";

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === "object" && !Array.isArray(val));
}

function hasServerEndpointField(cfg: Record<string, unknown>): boolean {
  return (
    "command" in cfg ||
    "url" in cfg ||
    "serverUrl" in cfg ||
    "type" in cfg
  );
}

export function normalizeMcpServerConfig(raw: Record<string, unknown>): McpServerConfig {
  const cfg: Record<string, unknown> = { ...raw };
  if (Array.isArray(raw.command)) {
    const cmdArr = raw.command;
    const cmdStr = typeof cmdArr[0] === "string" ? cmdArr[0] : String(cmdArr[0] || "");
    const argsStr = cmdArr.slice(1).map(String);
    cfg.command = cmdStr;
    if (argsStr.length > 0 && !cfg.args) {
      cfg.args = argsStr;
    }
  }
  if (typeof raw.serverUrl === "string" && raw.serverUrl.trim() && typeof cfg.url !== "string") {
    cfg.url = raw.serverUrl.trim();
    delete cfg.serverUrl;
  }
  return cfg as McpServerConfig;
}

export function readInstalledMcpServers(
  mcpConfigPath: string,
  key = "mcpServers"
): Record<string, McpServerConfig> {
  if (!mcpConfigPath) return {};
  try {
    const resolvedPath = expandHome(mcpConfigPath);
    if (!fs.existsSync(resolvedPath)) return {};
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) return {};
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const json: unknown = JSON.parse(stripJsonComments(raw));
    if (!isPlainRecord(json)) {
      return {};
    }
    if (isPrototypePollutionKey(key)) {
      return {};
    }

    let servers: unknown = Object.hasOwn(json, key) ? json[key] : undefined;

    // Fallbacks if default key is missing or not an object
    if (!isPlainRecord(servers)) {
      if (Object.hasOwn(json, "mcp") && isPlainRecord(json.mcp)) {
        servers = json.mcp;
      } else if (Object.hasOwn(json, "mcpServers") && isPlainRecord(json.mcpServers)) {
        servers = json.mcpServers;
      }
    }

    // Claude Code keeps per-project servers under projects[<abs path>].mcpServers
    // in ~/.claude.json. Surface them next to the user-level servers instead of
    // only when the top-level key is missing.
    if (key === "mcpServers" && Object.hasOwn(json, "projects") && isPlainRecord(json.projects)) {
      const projectMap = json.projects;
      const asServers = (v: unknown): Record<string, unknown> => (isPlainRecord(v) ? v : {});
      const hasTopLevel = isPlainRecord(servers) && Object.keys(servers).length > 0;
      const scoped: Record<string, unknown> = {};
      for (const dir of [os.homedir(), process.cwd()]) {
        const entry = Object.hasOwn(projectMap, dir) ? projectMap[dir] : undefined;
        if (isPlainRecord(entry)) {
          Object.assign(scoped, asServers(entry.mcpServers));
        }
      }
      if (!hasTopLevel && Object.keys(scoped).length === 0) {
        for (const proj of Object.values(projectMap)) {
          if (isPlainRecord(proj)) {
            Object.assign(scoped, asServers(proj.mcpServers));
          }
        }
      }
      if (Object.keys(scoped).length > 0) {
        servers = { ...(hasTopLevel && isPlainRecord(servers) ? servers : {}), ...scoped };
      }
    }

    if (!isPlainRecord(servers)) {
      return {};
    }

    const result: Record<string, McpServerConfig> = {};
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (isPrototypePollutionKey(serverName) || !isPlainRecord(serverConfig)) {
        continue;
      }

      // OpenCode support: if key is "servers" and value is an object of servers
      if (
        serverName === "servers" &&
        !hasServerEndpointField(serverConfig)
      ) {
        for (const [subName, subConfig] of Object.entries(serverConfig)) {
          if (!isPrototypePollutionKey(subName) && isPlainRecord(subConfig)) {
            result[subName] = normalizeMcpServerConfig(subConfig);
          }
        }
        continue;
      }

      // Ignore settings objects like timeout or other non-server configs
      if (!hasServerEndpointField(serverConfig)) {
        continue;
      }

      result[serverName] = normalizeMcpServerConfig(serverConfig);
    }

    return result;
  } catch {
    return {};
  }
}
