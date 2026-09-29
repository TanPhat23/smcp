import { isPrototypePollutionKey } from "../../utils/security.ts";
import { GitHubAuthProvider } from "./github.ts";
import type { AuthProvider } from "./types.ts";

function createDefaultAuthProviders(): AuthProvider[] {
  return [Object.freeze(new GitHubAuthProvider())];
}

let activeAuthProviders: AuthProvider[] = createDefaultAuthProviders();

function validateAuthProvider(provider: unknown): asserts provider is AuthProvider {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error("Invalid AuthProvider: must be a non-null object");
  }

  const candidate = provider as Record<string, unknown>;

  if (
    typeof candidate.id !== "string" ||
    !candidate.id.trim() ||
    !/^[a-zA-Z0-9_-]+$/.test(candidate.id.trim()) ||
    candidate.id.length > 64
  ) {
    throw new Error(
      "Invalid provider id: must be 1-64 alphanumeric characters, underscores, or hyphens"
    );
  }

  if (isPrototypePollutionKey(candidate.id)) {
    throw new Error(`Invalid provider id: prototype pollution key '${candidate.id}' is rejected`);
  }

  if (typeof candidate.name !== "string" || !candidate.name.trim()) {
    throw new Error(`AuthProvider '${candidate.id}' must implement a non-empty 'name' string`);
  }

  if (!Array.isArray(candidate.envVars) || candidate.envVars.some((v) => typeof v !== "string" || !v.trim())) {
    throw new Error(`AuthProvider '${candidate.id}' must implement an 'envVars' array of non-empty strings`);
  }

  if (typeof candidate.verify !== "function") {
    throw new Error(`AuthProvider '${candidate.id}' must implement a 'verify(token)' method`);
  }
}

/**
 * Registers an AuthProvider. Custom providers take precedence over defaults by default.
 */
export function registerAuthProvider(provider: AuthProvider, prepend = true): void {
  validateAuthProvider(provider);
  const safeProvider = Object.isFrozen(provider) ? provider : Object.freeze({ ...provider });
  activeAuthProviders = activeAuthProviders.filter(
    (p) => p.id.toLowerCase() !== safeProvider.id.toLowerCase()
  );

  if (prepend) {
    activeAuthProviders.unshift(safeProvider);
  } else {
    activeAuthProviders.push(safeProvider);
  }
}

/**
 * Unregisters an AuthProvider by id.
 */
export function unregisterAuthProvider(id: string): boolean {
  if (!id || typeof id !== "string" || isPrototypePollutionKey(id)) {
    return false;
  }
  const cleanId = id.trim().toLowerCase();
  const prevLength = activeAuthProviders.length;
  activeAuthProviders = activeAuthProviders.filter((p) => p.id.toLowerCase() !== cleanId);
  return activeAuthProviders.length < prevLength;
}

/**
 * Resolves a registered AuthProvider by id. Defaults to "github".
 */
export function getAuthProvider(id = "github"): AuthProvider | null {
  if (!id || typeof id !== "string" || isPrototypePollutionKey(id)) {
    return null;
  }
  const cleanId = id.trim().toLowerCase();
  const found = activeAuthProviders.find((p) => p.id.toLowerCase() === cleanId);
  return found || null;
}

/**
 * Returns a defensive read-only list of active AuthProviders.
 */
export function getAllAuthProviders(): readonly AuthProvider[] {
  return Object.freeze([...activeAuthProviders]);
}

/**
 * Resets all active AuthProviders to default built-ins.
 */
export function resetAuthProviders(): void {
  activeAuthProviders = createDefaultAuthProviders();
}
