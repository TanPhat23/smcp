/**
 * Contextual metadata provided to custom secret detectors when evaluating
 * an MCP server configuration entry (environment variable, CLI argument, or URL).
 */
export interface SecretDetectionContext {
  /**
   * The name or key of the environment variable or argument flag (e.g., "API_KEY", "--token").
   */
  key?: string;

  /**
   * The raw value being evaluated (e.g., "sk-ant-...", "postgresql://...").
   */
  value?: string;

  /**
   * The identifier/name of the MCP server where this value was found.
   */
  serverName?: string;

  /**
   * The origin location of this item within the MCP server definition:
   * - "env": From the server's `env` mapping.
   * - "arg": From the server's `args` array.
   * - "url": From the server's remote endpoint `url`.
   */
  source?: "env" | "arg" | "url";
}

/**
 * Result returned by a custom secret detector function when it identifies a secret.
 */
export interface SecretDetectionResult {
  /**
   * Whether the inspected target is sensitive and must be redacted.
   */
  isSecret: boolean;

  /**
   * Optional custom human-readable description for the generated environment variable placeholder.
   */
  description?: string;

  /**
   * Optional suggested environment variable key name for the placeholder (e.g. "MY_CUSTOM_SECRET").
   */
  suggestedKey?: string;
}

/**
 * Custom secret detector function signature.
 * Allows programmatic callers or AI agents to inspect items contextually and return:
 * - `true` / `false` to indicate secret status.
 * - `SecretDetectionResult` to specify custom descriptions or suggested placeholder keys.
 * - `null` / `undefined` to defer to standard regex matching.
 */
export type SecretDetectorFn = (
  context: SecretDetectionContext
) => boolean | SecretDetectionResult | null | undefined;

/**
 * Configuration options passed to secret detection and redaction functions.
 * Enables runtime customization of key names, value patterns, exclusions, and custom inspectors.
 */
export interface RedactorOptions {
  /**
   * Additional secret key patterns (RegExp or strings like "ORG_TOKEN_*", "/^secret_/i").
   */
  extraKeyPatterns?: (RegExp | string)[];

  /**
   * Additional secret value regex patterns to detect tokens (e.g., [/^vault-tok-[0-9]+/]).
   */
  extraValuePatterns?: (RegExp | string)[];

  /**
   * Patterns of keys to explicitly exclude from redaction (allowlisting false positives like "PUBLIC_KEY").
   */
  excludeKeyPatterns?: (RegExp | string)[];

  /**
   * Custom detector functions for dynamic, context-aware secret identification.
   */
  customDetectors?: SecretDetectorFn[];
}
