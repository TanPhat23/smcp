import { type AuthConfig } from "../../types/index.ts";
import type { AuthUser } from "../auth/types.ts";
export declare function getStoredAuthConfig(): AuthConfig;
export declare function getAuthConfig(): AuthConfig;
export declare function saveAuthConfig(config: AuthConfig): void;
export declare function clearAuthConfig(): void;
/**
 * Resolves the authentication token for a given provider (defaulting to "github").
 * Checks provider envVars first, then config.tokens[provider], then fallback to config.githubToken.
 */
export declare function getAuthToken(provider?: string): string | undefined;
/**
 * Saves provider credentials into auth config with full backward compatibility.
 */
export declare function saveProviderAuth(provider: string, token: string, user: AuthUser): void;
/**
 * Clears provider credentials from auth config. If all tokens are empty, removes config file.
 */
export declare function clearProviderAuth(provider?: string): void;
