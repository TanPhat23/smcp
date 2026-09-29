import type { AuthProvider } from "./types.ts";
/**
 * Registers an AuthProvider. Custom providers take precedence over defaults by default.
 */
export declare function registerAuthProvider(provider: AuthProvider, prepend?: boolean): void;
/**
 * Unregisters an AuthProvider by id.
 */
export declare function unregisterAuthProvider(id: string): boolean;
/**
 * Resolves a registered AuthProvider by id. Defaults to "github".
 */
export declare function getAuthProvider(id?: string): AuthProvider | null;
/**
 * Returns a defensive read-only list of active AuthProviders.
 */
export declare function getAllAuthProviders(): readonly AuthProvider[];
/**
 * Resets all active AuthProviders to default built-ins.
 */
export declare function resetAuthProviders(): void;
