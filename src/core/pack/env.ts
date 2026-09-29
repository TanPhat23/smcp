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
  }

  return requiredEnvList;
}
