import type { AuthProvider, AuthUser } from "./types.ts";
export declare class GitHubAuthProvider implements AuthProvider {
    readonly id = "github";
    readonly name = "GitHub";
    readonly envVars: string[];
    verify(token: string): Promise<AuthUser>;
    getInstructions(): string;
}
