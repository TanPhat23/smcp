import type { McpServerConfig } from "@tanphat/smcp-core";

export function resolveMcpServerTemplates(
  servers: Record<string, McpServerConfig>,
  envValues: Record<string, string>,
  options?: { nativeEnvAgent?: string; useNativeEnv?: boolean }
): Record<string, McpServerConfig> {
  const isOpencode =
    options?.nativeEnvAgent === "opencode" ||
    (typeof options?.nativeEnvAgent === "string" && options.nativeEnvAgent.includes("opencode"));
  const fallbackPlaceholder = (v: string) => (isOpencode ? `{env:${v}}` : `\${${v}}`);

  const replaceVar = (_: string, varName: string) => {
    if (options?.useNativeEnv) {
      return fallbackPlaceholder(varName);
    }
    return Object.hasOwn(envValues, varName) && envValues[varName] !== undefined
      ? envValues[varName]
      : fallbackPlaceholder(varName);
  };

  const resolvedServers: Record<string, McpServerConfig> = {};
  for (const [sName, sConf] of Object.entries(servers)) {
    const resolved: McpServerConfig = { ...sConf };

    if (typeof sConf.command === "string") {
      resolved.command = sConf.command.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar);
    } else if (Array.isArray(sConf.command)) {
      resolved.command = sConf.command.map((cmd) =>
        typeof cmd === "string" ? cmd.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar) : String(cmd)
      );
    }

    if (sConf.env) {
      const updatedEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(sConf.env)) {
        updatedEnv[k] = v.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar);
      }
      resolved.env = updatedEnv;
    }

    if (sConf.args) {
      resolved.args = sConf.args.map((arg) =>
        arg.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar)
      );
    }

    if (sConf.url) {
      resolved.url = sConf.url.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar);
    }

    if (sConf.headers && typeof sConf.headers === "object" && !Array.isArray(sConf.headers)) {
      const updatedHeaders: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(sConf.headers)) {
        updatedHeaders[k] =
          typeof v === "string" ? v.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar) : v;
      }
      resolved.headers = updatedHeaders;
    }

    resolvedServers[sName] = resolved;
  }
  return resolvedServers;
}
