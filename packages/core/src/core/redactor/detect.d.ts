import type { RedactorOptions, SecretDetectionContext, SecretDetectionResult, SecretDetectorFn } from "../../types/index.ts";
/**
 * Standard regular expressions matching common secret, credential, and authentication key names.
 * Checked case-insensitively against environment variable keys and argument parameter names.
 */
export declare const DEFAULT_SECRET_KEY_PATTERNS: RegExp[];
/**
 * High-entropy regular expressions matching well-known token formats across modern cloud and AI platforms.
 * Covers OpenAI, Anthropic, Google Gemini, AWS, GitHub, Slack, HuggingFace, Supabase, GitLab, Stripe, etc.
 */
export declare const DEFAULT_SECRET_VALUE_PATTERNS: RegExp[];
/**
 * Regular expression matching database connection URIs containing embedded passwords.
 * Example: `postgresql://user:secret@localhost:5432/db` or `redis://:password@localhost:6379`.
 */
export declare const CONNECTION_STRING_PATTERN: RegExp;
/**
 * Regular expression matching single `${VARIABLE_NAME}` template placeholders.
 * Used to identify variables that have already been templated and prevent double-redaction.
 */
export declare const SINGLE_PLACEHOLDER_REGEX: RegExp;
/**
 * Converts a string pattern or existing RegExp into a compiled RegExp object.
 *
 * Supported formats:
 * - Direct RegExp objects: preserved as-is.
 * - Slash-delimited strings: `"/^my-token-[0-9]+$/i"` -> `new RegExp("^my-token-[0-9]+$", "i")`.
 * - Glob strings: `"MY_CORP_*"` or `"*_TOKEN"` -> `new RegExp("^MY_CORP_.*$", "i")`.
 * - Literal strings: `"INTERNAL_API"` -> case-insensitive substring match `new RegExp("INTERNAL_API", "i")`.
 *
 * @param input - The pattern to normalize.
 * @returns A compiled RegExp instance. If input is empty or invalid, returns a non-matching regex `/(?!)/`.
 */
export declare function normalizePattern(input: RegExp | string): RegExp;
/**
 * Dynamically registers one or more secret key patterns for the current process runtime.
 * Discards empty inputs and prototype pollution keys (__proto__, constructor, prototype).
 *
 * @param patterns - One or more regex patterns, glob strings, or substring filters.
 *
 * @example
 * ```ts
 * registerSecretKeyPatterns("CUSTOM_AUTH_*", "/^ORG_[A-Z0-9]+$/i");
 * ```
 */
export declare function registerSecretKeyPatterns(...patterns: (RegExp | string)[]): void;
/**
 * Dynamically registers one or more secret value patterns for the current process runtime.
 * Discards empty inputs and prototype pollution keys.
 *
 * @param patterns - One or more regex patterns or strings matching raw secret values.
 *
 * @example
 * ```ts
 * registerSecretValuePatterns(/^vault-token-[a-f0-9]{32}$/);
 * ```
 */
export declare function registerSecretValuePatterns(...patterns: (RegExp | string)[]): void;
/**
 * Registers key patterns that should be explicitly excluded from secret detection (allowlisting).
 * Exclusions take precedence over both default and registered secret patterns.
 *
 * @param patterns - Key patterns that should never be marked as secrets (e.g. "PUBLIC_KEY", "KEYBOARD_*").
 *
 * @example
 * ```ts
 * registerExcludedKeyPatterns(/^PUBLIC_/, "KEYBOARD_LAYOUT");
 * ```
 */
export declare function registerExcludedKeyPatterns(...patterns: (RegExp | string)[]): void;
/**
 * Registers a custom detector function for deep or context-aware secret inspection.
 *
 * @param detector - A function that inspects { key, value, serverName, source } and returns secret status.
 */
export declare function registerCustomDetector(detector: SecretDetectorFn): void;
/**
 * Resets all runtime registered key patterns, value patterns, exclusions, and custom detectors.
 * Restores the redactor engine to its default built-in configuration.
 */
export declare function resetCustomSecretPatterns(): void;
/**
 * Retrieves a snapshot of the active secret patterns (defaults and registered runtime additions).
 * Returns defensive copies so callers cannot mutate the internal state directly.
 */
export declare function getSecretPatterns(): {
    defaultKeyPatterns: RegExp[];
    defaultValuePatterns: RegExp[];
    registeredKeyPatterns: RegExp[];
    registeredValuePatterns: RegExp[];
    registeredExcludedKeyPatterns: RegExp[];
};
/**
 * Determines whether a given key name represents a sensitive credential.
 *
 * Evaluation order:
 * 1. Exclusions (options, runtime registered, SMCP_EXCLUDE_SECRET_KEYS) -> if matched, returns false.
 * 2. Default key patterns (TOKEN, SECRET, KEY, PASSWORD, etc.) -> if matched, returns true.
 * 3. Registered runtime key patterns.
 * 4. Caller options `extraKeyPatterns`.
 * 5. Environment variable patterns from `SMCP_EXTRA_SECRET_KEYS`.
 *
 * @param key - The key name to inspect (e.g. "DATABASE_PASSWORD", "API_KEY").
 * @param options - Optional per-call redactor options.
 * @returns True if the key is sensitive and must be redacted.
 */
export declare function isSecretKey(key: string, options?: RedactorOptions): boolean;
/**
 * Determines whether a given string value looks like a sensitive credential, token, or password.
 *
 * Checks connection URIs (e.g. postgres://...:password@...), high-entropy token patterns
 * (e.g. ghp_..., sk-..., AIzaSy...), registered runtime value patterns, options, and env patterns.
 *
 * @param value - The raw string value to inspect.
 * @param options - Optional per-call redactor options.
 * @returns True if the value matches known secret formats.
 */
export declare function isSecretValue(value: string, options?: RedactorOptions): boolean;
/**
 * Evaluates an entry using custom detector functions, key heuristics, and value patterns.
 *
 * Custom detectors run first, allowing custom metadata (such as custom descriptions or suggested
 * environment variable key names) to be attached to the detection result.
 *
 * @param context - Metadata about the value, its key name, server, and source location.
 * @param options - Optional per-call redactor configuration.
 * @returns An object indicating whether the target is a secret and optional metadata.
 */
export declare function detectSecret(context: SecretDetectionContext, options?: RedactorOptions): SecretDetectionResult;
/**
 * Generates a POSIX-compliant environment variable prefix based on an MCP server name.
 * Sanitizes non-alphanumeric characters to underscores and ensures the prefix does not begin with a digit.
 *
 * @param serverName - The name of the server (e.g., "1password", "my-github-api").
 * @returns A safe uppercase string suitable for env var naming (e.g. "_1PASSWORD", "MY_GITHUB_API").
 */
export declare function getSafePrefix(serverName: string): string;
/**
 * Checks whether a URL contains embedded credentials in its authority section (user:pass@host)
 * or in query parameters matching known secret keys or token values.
 *
 * @param url - The remote server URL to inspect.
 * @param options - Optional redactor configuration.
 * @returns True if credentials or secrets are found within the URL.
 */
export declare function urlContainsCredentials(url: string, options?: RedactorOptions): boolean;
