import { execSync } from "node:child_process";
import type { McpServerConfig } from "../../types/index.ts";

/**
 * Normalizes runtime identifier into canonical runner form:
 * - "npm", "npx" -> "npx"
 * - "bun", "bunx" -> "bunx"
 * - "pnpm", "pnpx" -> "pnpm"
 */
export function normalizeRuntime(runtime?: string): string {
  if (!runtime || typeof runtime !== "string") return "npx";
  const trimmed = runtime.trim().toLowerCase();
  if (trimmed === "npm" || trimmed === "npx") return "npx";
  if (trimmed === "bun" || trimmed === "bunx") return "bunx";
  if (trimmed === "pnpm" || trimmed === "pnpx") return "pnpm";
  return trimmed;
}

/**
 * Detects the available package execution runtime on the system.
 * Checks for bun first; if unavailable, falls back to npx.
 */
export function detectAvailableRuntime(): "bunx" | "npx" {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return "bunx";
  } catch {
    return "npx";
  }
}

function isRunnerCommand(cmd: string): boolean {
  return cmd === "bunx" || cmd === "npx" || cmd === "pnpx";
}

/**
 * Transforms an MCP server's command and arguments to use the specified target runtime.
 * Only transforms runner commands (bunx, npx, pnpm dlx).
 * Non-runner commands (such as node, python, docker, uvx) remain untouched.
 */
export function transformMcpServerRuntime(
  serverConfig: McpServerConfig,
  targetRuntime?: string
): McpServerConfig {
  if (!serverConfig || typeof serverConfig !== "object") {
    return serverConfig;
  }

  const target = normalizeRuntime(targetRuntime);

  // Case 1: Array command format (e.g. OpenCode V2 ["bunx", "-y", "@pkg"])
  if (Array.isArray(serverConfig.command)) {
    const cmdArr = (serverConfig.command as unknown[]).map(String);
    if (cmdArr.length === 0) return { ...serverConfig };

    const first = cmdArr[0];
    const isPnpmDlx = first === "pnpm" && cmdArr[1] === "dlx";

    if (!isRunnerCommand(first) && !isPnpmDlx) {
      return { ...serverConfig };
    }

    const restTokens = isPnpmDlx ? cmdArr.slice(2) : cmdArr.slice(1);

    if (target === "npx") {
      const hasY = restTokens.includes("-y") || restTokens.includes("--yes");
      const finalTokens = hasY ? restTokens : ["-y", ...restTokens];
      return {
        ...serverConfig,
        command: ["npx", ...finalTokens]
      };
    }

    if (target === "bunx") {
      return {
        ...serverConfig,
        command: ["bunx", ...restTokens]
      };
    }

    if (target === "pnpm") {
      const pnpmTokens = restTokens.filter((t) => t !== "-y" && t !== "--yes");
      return {
        ...serverConfig,
        command: ["pnpm", "dlx", ...pnpmTokens]
      };
    }

    return {
      ...serverConfig,
      command: [target, ...restTokens]
    };
  }

  // Case 2: String command format
  if (typeof serverConfig.command === "string") {
    const rawCmd = serverConfig.command.trim();

    // Subcase 2a: Command + separate args
    if (Array.isArray(serverConfig.args) && isRunnerCommand(rawCmd)) {
      const currentArgs = serverConfig.args.map(String);

      if (target === "npx") {
        const hasY = currentArgs.includes("-y") || currentArgs.includes("--yes");
        return {
          ...serverConfig,
          command: "npx",
          args: hasY ? currentArgs : ["-y", ...currentArgs]
        };
      }

      if (target === "bunx") {
        return {
          ...serverConfig,
          command: "bunx",
          args: currentArgs
        };
      }

      if (target === "pnpm") {
        const pnpmArgs = currentArgs.filter((a) => a !== "-y" && a !== "--yes");
        return {
          ...serverConfig,
          command: "pnpm",
          args: ["dlx", ...pnpmArgs]
        };
      }

      return {
        ...serverConfig,
        command: target,
        args: currentArgs
      };
    }

    // Subcase 2b: Inline command string (e.g. "bunx @playwright/mcp@latest")
    const match = rawCmd.match(/^(bunx|npx|pnpx|pnpm\s+dlx)\b\s*(.*)$/);
    if (match) {
      const argsPart = match[2].trim();

      if (target === "npx") {
        const hasY = /(?:^|\s)-y(?:\s|$)/.test(argsPart) || /(?:^|\s)--yes(?:\s|$)/.test(argsPart);
        const formattedArgs = hasY ? argsPart : (argsPart ? `-y ${argsPart}` : "-y");
        return {
          ...serverConfig,
          command: `npx ${formattedArgs}`.trim()
        };
      }

      if (target === "bunx") {
        return {
          ...serverConfig,
          command: `bunx ${argsPart}`.trim()
        };
      }

      if (target === "pnpm") {
        const cleanArgs = argsPart.replace(/(?:^|\s)-(?:y|-yes)(?:\s|$)/g, " ").trim();
        return {
          ...serverConfig,
          command: `pnpm dlx ${cleanArgs}`.trim()
        };
      }

      return {
        ...serverConfig,
        command: `${target} ${argsPart}`.trim()
      };
    }
  }

  return { ...serverConfig };
}
