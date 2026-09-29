export interface AuthUser {
  username: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}

export interface AuthProviderContext {
  provider?: string;
  token?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthProvider {
  readonly id: string;
  readonly name: string;
  readonly envVars: string[];
  verify(token: string): Promise<AuthUser>;
  getInstructions?(): string;
}
