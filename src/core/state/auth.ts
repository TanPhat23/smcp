import fs from "node:fs";
import { AuthConfigSchema, type AuthConfig } from "../../types/index.ts";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { ensureSmcpDir, getConfigPath } from "./paths.ts";

export function getAuthConfig(): AuthConfig {
  ensureSmcpDir();
  const configFile = getConfigPath();
  let saved: AuthConfig = {};

  if (fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, "utf8");
      const parsed = JSON.parse(raw);
      const validated = AuthConfigSchema.safeParse(parsed);
      if (validated.success) {
        saved = validated.data;
      }
    } catch {
      saved = {};
    }
  }

  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim().length > 0) {
    return {
      ...saved,
      githubToken: process.env.GITHUB_TOKEN.trim()
    };
  }

  return saved;
}

export function saveAuthConfig(config: AuthConfig): void {
  const validated = AuthConfigSchema.parse(config);
  ensureSmcpDir();
  const configFile = getConfigPath();

  atomicWriteFileSync(configFile, JSON.stringify(validated, null, 2), { mode: 0o600 });
}

export function clearAuthConfig(): void {
  const configFile = getConfigPath();
  try {
    fs.unlinkSync(configFile);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}
