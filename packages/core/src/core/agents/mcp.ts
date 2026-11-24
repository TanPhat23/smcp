import fs from "node:fs";
import os from "node:os";
import type { McpServerConfig } from "../../types/index.ts";
import { expandHome } from "../../utils/paths.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { stripJsonComments } from "./jsonc.ts";

export function normalizeMcpServerConfig(raw: Record<string, unknown>): McpServerConfig {
  const cfg = { ...raw } as unknown as McpServerConfig;
  if (Array.isArray(raw.command)) {
    const cmdArr = raw.command as unknown[];
    const cmdStr = typeof cmdArr[0] === "string" ? cmdArr[0] : String(cmdArr[0] || "");
    const argsStr = cmdArr.slice(1).map(String);
    cfg.command = cmdStr;
    if (argsStr.length > 0 && !cfg.args) {
      cfg.args = argsStr;
    }
  }
  return cfg;
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
    const json = JSON.parse(stripJsonComments(raw));
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return {};
    }
    if (isPrototypePollutionKey(key)) {
      return {};
    }

    let servers: unknown = undefined;
    if (Object.hasOwn(json, key)) {
      servers = (json as Record<string, unknown>)[key];
    }

    // Fallbacks if default key is missing or not an object
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      // Check OpenCode "mcp" key
      if (Object.hasOwn(json, "mcp")) {
        const mcpVal = (json as Record<string, unknown>).mcp;
        if (mcpVal && typeof mcpVal === "object" && !Array.isArray(mcpVal)) {
          servers = mcpVal;
        }
      } else if (Object.hasOwn(json, "mcpServers")) {
        const mcpServersVal = (json as Record<string, unknown>).mcpServers;
        if (mcpServersVal && typeof mcpServersVal === "object" && !Array.isArray(mcpServersVal)) {
          servers = mcpServersVal;
        }
      }
    }

    // Claude Code keeps per-project servers under projects[<abs path>].mcpServers
    // in ~/.claude.json. Surface them next to the user-level servers instead of
    // only when the top-level key is missing.
    if (key === "mcpServers" && Object.hasOwn(json, "projects")) {
      const projects = (json as Record<string, unknown>).projects;
      if (projects && typeof projects === "object" && !Array.isArray(projects)) {
        const projectMap = projects as Record<string, Record<string, unknown>>;
        const asServers = (v: unknown): Record<string, unknown> =>
          v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
        const hasTopLevel =
          servers && typeof servers === "object" && !Array.isArray(servers) && Object.keys(servers).length > 0;
        const scoped: Record<string, unknown> = {};
        for (const dir of [os.homedir(), process.cwd()]) {
          if (Object.hasOwn(projectMap, dir) && projectMap[dir] && typeof projectMap[dir] === "object") {
            Object.assign(scoped, asServers(projectMap[dir].mcpServers));
          }
        }
        if (!hasTopLevel && Object.keys(scoped).length === 0) {
          for (const proj of Object.values(projectMap)) {
            if (proj && typeof proj === "object") Object.assign(scoped, asServers(proj.mcpServers));
          }
        }
        if (Object.keys(scoped).length > 0) {
          servers = { ...(hasTopLevel ? (servers as Record<string, unknown>) : {}), ...scoped };
        }
      }
    }

    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      return {};
    }

    const result: Record<string, McpServerConfig> = {};
    for (const [serverName, serverConfig] of Object.entries(servers as Record<string, unknown>)) {
      if (isPrototypePollutionKey(serverName) || !serverConfig || typeof serverConfig !== "object") {
        continue;
      }

      // OpenCode support: if key is "servers" and value is an object of servers (e.g. grep, webmcp)
      if (
        serverName === "servers" &&
        !("command" in (serverConfig as object)) &&
        !("url" in (serverConfig as object))
      ) {
        for (const [subName, subConfig] of Object.entries(serverConfig as Record<string, unknown>)) {
          if (!isPrototypePollutionKey(subName) && subConfig && typeof subConfig === "object") {
            result[subName] = normalizeMcpServerConfig(subConfig as Record<string, unknown>);
          }
        }
        continue;
      }

      // Ignore settings objects like timeout or other non-server configs
      if (
        !("command" in (serverConfig as object)) &&
        !("url" in (serverConfig as object)) &&
        !("type" in (serverConfig as object))
      ) {
        continue;
      }

      result[serverName] = normalizeMcpServerConfig(serverConfig as Record<string, unknown>);
    }

    return result;
  } catch {
    return {};
  }
}
