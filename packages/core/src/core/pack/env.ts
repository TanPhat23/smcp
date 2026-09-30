import type { Manifest, RedactorOptions, RequiredEnv } from "../../types/index.ts";
import { isSecretKey } from "../redactor/index.ts";

export function collectRequiredEnv(manifest: Manifest, options?: RedactorOptions): RequiredEnv[] {
  const requiredEnvList: RequiredEnv[] = [...(manifest.requiredEnv || [])];
  const knownKeys = new Set(requiredEnvList.map((r) => r.key));

  const scanForPlaceholders = (str: string, isSecret = false) => {
    const matches = str.matchAll(/\${([a-zA-Z0-9_]+)}/g);
    for (const m of matches) {
      const varName = m[1];
      if (!knownKeys.has(varName)) {
        knownKeys.add(varName);
        requiredEnvList.push({
          key: varName,
          description: `Environment variable (${varName})`,
          isSecret
        });
      }
    }
  };

  for (const sConf of Object.values(manifest.mcpServers || {})) {
    const rawCmd = (sConf as Record<string, unknown>).command;
    if (typeof rawCmd === "string") {
      scanForPlaceholders(rawCmd, false);
    } else if (Array.isArray(rawCmd)) {
      for (const cmd of rawCmd) {
        if (typeof cmd === "string") {
          scanForPlaceholders(cmd, false);
        }
      }
    }
    if (sConf.env) {
      for (const [k, v] of Object.entries(sConf.env)) {
        scanForPlaceholders(v, isSecretKey(k, options));
      }
    }
    if (sConf.args) {
      for (const arg of sConf.args) {
        scanForPlaceholders(arg, false);
      }
    }
    if (sConf.url) {
      scanForPlaceholders(sConf.url, false);
    }
    const headers = (sConf as any).headers;
    if (headers && typeof headers === "object" && !Array.isArray(headers)) {
      for (const [hk, hv] of Object.entries(headers)) {
        if (typeof hv === "string") {
          scanForPlaceholders(hv, isSecretKey(hk, options) || hk.toLowerCase() === "authorization");
        }
      }
    }
  }

  return requiredEnvList;
}
