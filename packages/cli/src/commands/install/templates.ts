import type { McpServerConfig } from "@tanphat/smcp-core";

export function resolveMcpServerTemplates(
  servers: Record<string, McpServerConfig>,
  envValues: Record<string, string>
): Record<string, McpServerConfig> {
  const replaceVar = (_: string, varName: string) => {
    return Object.hasOwn(envValues, varName) && envValues[varName] !== undefined
      ? envValues[varName]
      : `\${${varName}}`;
  };

  const resolvedServers: Record<string, McpServerConfig> = {};
  for (const [sName, sConf] of Object.entries(servers)) {
    const resolved: McpServerConfig = { ...sConf };

    if (typeof sConf.command === "string") {
      resolved.command = sConf.command.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar);
    } else if (Array.isArray(sConf.command)) {
      resolved.command = (sConf.command as unknown[]).map((cmd) =>
        typeof cmd === "string" ? cmd.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar) : cmd
      ) as any;
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

    if ((sConf as any).headers && typeof (sConf as any).headers === "object") {
      const updatedHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries((sConf as any).headers)) {
        if (typeof v === "string") {
          updatedHeaders[k] = v.replace(/\${([a-zA-Z0-9_]+)}/g, replaceVar);
        } else {
          updatedHeaders[k] = v as any;
        }
      }
      (resolved as any).headers = updatedHeaders;
    }

    resolvedServers[sName] = resolved;
  }
  return resolvedServers;
}
