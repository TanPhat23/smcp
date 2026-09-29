import fs from "node:fs";
import { AuthConfigSchema, type AuthConfig } from "../../types/index.ts";
import { atomicWriteFileSync } from "../../utils/fs.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";
import { getAuthProvider } from "../auth/registry.ts";
import type { AuthUser } from "../auth/types.ts";
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

/**
 * Resolves the authentication token for a given provider (defaulting to "github").
 * Checks provider envVars first, then config.tokens[provider], then fallback to config.githubToken.
 */
export function getAuthToken(provider = "github"): string | undefined {
  if (!provider || typeof provider !== "string" || isPrototypePollutionKey(provider)) {
    return undefined;
  }

  const cleanProvider = provider.trim().toLowerCase();
  const authProvider = getAuthProvider(cleanProvider);

  if (authProvider && Array.isArray(authProvider.envVars)) {
    for (const envVar of authProvider.envVars) {
      const val = process.env[envVar];
      if (typeof val === "string" && val.trim().length > 0) {
        return val.trim();
      }
    }
  }

  const config = getAuthConfig();
  if (
    config.tokens &&
    typeof config.tokens[cleanProvider] === "string" &&
    config.tokens[cleanProvider].trim().length > 0
  ) {
    return config.tokens[cleanProvider].trim();
  }

  if (cleanProvider === "github" && config.githubToken && config.githubToken.trim().length > 0) {
    return config.githubToken.trim();
  }

  return undefined;
}

/**
 * Saves provider credentials into auth config with full backward compatibility.
 */
export function saveProviderAuth(
  provider: string,
  token: string,
  user: AuthUser
): void {
  if (!provider || typeof provider !== "string" || isPrototypePollutionKey(provider)) {
    throw new Error(`Invalid provider id '${provider}'`);
  }

  const cleanProvider = provider.trim().toLowerCase();
  const config = getAuthConfig();
  const tokens = { ...(config.tokens || {}) };
  const providers = { ...(config.providers || {}) };

  tokens[cleanProvider] = token;
  providers[cleanProvider] = {
    username: user.username,
    scopes: user.scopes,
    metadata: user.metadata
  };

  const updated: AuthConfig = {
    ...config,
    tokens,
    providers
  };

  if (cleanProvider === "github") {
    updated.githubToken = token;
    updated.githubUser = user.username;
  }

  saveAuthConfig(updated);
}

/**
 * Clears provider credentials from auth config. If all tokens are empty, removes config file.
 */
export function clearProviderAuth(provider = "github"): void {
  if (!provider || typeof provider !== "string" || isPrototypePollutionKey(provider)) {
    return;
  }

  const cleanProvider = provider.trim().toLowerCase();
  const config = getAuthConfig();
  const tokens = { ...(config.tokens || {}) };
  const providers = { ...(config.providers || {}) };

  delete tokens[cleanProvider];
  delete providers[cleanProvider];

  const updated: AuthConfig = {
    ...config,
    tokens,
    providers
  };

  if (cleanProvider === "github") {
    delete updated.githubToken;
    delete updated.githubUser;
  }

  const remainingTokens = Object.keys(updated.tokens || {}).length;
  const hasLegacyToken = Boolean(updated.githubToken);

  if (remainingTokens === 0 && !hasLegacyToken) {
    clearAuthConfig();
  } else {
    saveAuthConfig(updated);
  }
}
