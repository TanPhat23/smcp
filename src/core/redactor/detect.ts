import type {
  RedactorOptions,
  SecretDetectionContext,
  SecretDetectionResult,
  SecretDetectorFn
} from "../../types/index.ts";
import { isPrototypePollutionKey } from "../../utils/security.ts";

/**
 * Standard regular expressions matching common secret, credential, and authentication key names.
 * Checked case-insensitively against environment variable keys and argument parameter names.
 */
export const DEFAULT_SECRET_KEY_PATTERNS: RegExp[] = [
  /TOKEN/i,
  /SECRET/i,
  /KEY/i,
  /PASSWORD/i,
  /PASSWD/i,
  /PASS/i,
  /PASSPHRASE/i,
  /CREDENTIAL/i,
  /AUTH/i,
  /PRIVATE/i,
  /SIGNATURE/i,
  /CERTIFICATE/i,
  /SESSION_TOKEN/i,
  /API_?KEY/i,
  /ACCESS_?KEY/i
];

/**
 * High-entropy regular expressions matching well-known token formats across modern cloud and AI platforms.
 * Covers OpenAI, Anthropic, Google Gemini, AWS, GitHub, Slack, HuggingFace, Supabase, GitLab, Stripe, etc.
 */
export const DEFAULT_SECRET_VALUE_PATTERNS: RegExp[] = [
  /^ghp_[a-zA-Z0-9]{36}$/,                         // GitHub PAT (classic)
  /^github_pat_[a-zA-Z0-9_]{82}$/,                 // GitHub Fine-grained PAT
  /^gh[pousr]_[a-zA-Z0-9]{36,255}$/,               // GitHub tokens (OAuth, user, server, refresh)
  /^sk[_-][a-zA-Z0-9_-]{20,}$/,                    // OpenAI / Anthropic / Stripe keys
  /^sk-(?:proj-|admin-)?[a-zA-Z0-9_-]{20,}$/,      // OpenAI project / admin keys
  /^sk-ant-[a-zA-Z0-9_-]{20,}$/,                   // Anthropic API keys
  /^AIzaSy[a-zA-Z0-9_-]{33}$/,                     // Google / Firebase API keys
  /^(?:AKIA|ASIA)[0-9A-Z]{16}$/,                   // AWS Access Key ID
  /^xox[bapr]-[a-zA-Z0-9_-]+/,                     // Slack tokens (bot, user, app, refresh)
  /^hf_[a-zA-Z0-9]+/,                              // HuggingFace token
  /^sbp_[a-zA-Z0-9_]{30,}$/,                       // Supabase service tokens
  /^glpat-[a-zA-Z0-9_-]{20,}$/,                    // GitLab PAT
  /^(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}$/,    // Stripe secret & restricted keys
  /^npm_[a-zA-Z0-9]{36}$/,                         // NPM access token
  /^re_[a-zA-Z0-9]{32,}$/,                         // Resend API key
  /^ey[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/ // JWT token
];

/**
 * Regular expression matching database connection URIs containing embedded passwords.
 * Example: `postgresql://user:secret@localhost:5432/db` or `redis://:password@localhost:6379`.
 */
export const CONNECTION_STRING_PATTERN = /^[a-zA-Z0-9+]+:\/\/[^:]*:[^@]+@.+/;

/**
 * Regular expression matching single `${VARIABLE_NAME}` template placeholders.
 * Used to identify variables that have already been templated and prevent double-redaction.
 */
export const SINGLE_PLACEHOLDER_REGEX = /^\${([a-zA-Z_][a-zA-Z0-9_]*)}$/;

// In-memory runtime registry for programmatic & AI agent extension
let registeredKeyPatterns: RegExp[] = [];
let registeredValuePatterns: RegExp[] = [];
let registeredExcludedKeyPatterns: RegExp[] = [];
let registeredCustomDetectors: SecretDetectorFn[] = [];

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
export function normalizePattern(input: RegExp | string): RegExp {
  if (input instanceof RegExp) {
    return input;
  }
  if (typeof input !== "string") {
    return /(?!)/;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return /(?!)/;
  }

  // 1. Check if string is formatted as /pattern/flags
  const slashMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  if (slashMatch) {
    try {
      return new RegExp(slashMatch[1], slashMatch[2]);
    } catch {
      // Fallback if flags are invalid
    }
  }

  // 2. Glob-like wildcards (* or ?)
  if (trimmed.includes("*") || trimmed.includes("?")) {
    const escaped = trimmed
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i");
  }

  // 3. Fallback: case-insensitive literal substring match
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i");
}

/**
 * Parses comma-separated pattern strings from an environment variable into compiled RegExp patterns.
 *
 * @param envVar - Comma-separated string from process.env (e.g., "TOKEN_*,/^custom-[0-9]+$/").
 * @returns An array of normalized RegExp objects.
 */
function parseEnvPatterns(envVar?: string): RegExp[] {
  if (!envVar || !envVar.trim()) return [];
  return envVar
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizePattern);
}

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
export function registerSecretKeyPatterns(...patterns: (RegExp | string)[]): void {
  for (const p of patterns) {
    if (!p) continue;
    if (typeof p === "string" && isPrototypePollutionKey(p)) continue;
    if (p instanceof RegExp || typeof p === "string") {
      const norm = normalizePattern(p);
      if (norm.source !== "(?!)") {
        registeredKeyPatterns.push(norm);
      }
    }
  }
}

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
export function registerSecretValuePatterns(...patterns: (RegExp | string)[]): void {
  for (const p of patterns) {
    if (!p) continue;
    if (typeof p === "string" && isPrototypePollutionKey(p)) continue;
    if (p instanceof RegExp || typeof p === "string") {
      const norm = normalizePattern(p);
      if (norm.source !== "(?!)") {
        registeredValuePatterns.push(norm);
      }
    }
  }
}

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
export function registerExcludedKeyPatterns(...patterns: (RegExp | string)[]): void {
  for (const p of patterns) {
    if (!p) continue;
    if (typeof p === "string" && isPrototypePollutionKey(p)) continue;
    if (p instanceof RegExp || typeof p === "string") {
      const norm = normalizePattern(p);
      if (norm.source !== "(?!)") {
        registeredExcludedKeyPatterns.push(norm);
      }
    }
  }
}

/**
 * Registers a custom detector function for deep or context-aware secret inspection.
 *
 * @param detector - A function that inspects { key, value, serverName, source } and returns secret status.
 */
export function registerCustomDetector(detector: SecretDetectorFn): void {
  if (typeof detector === "function") {
    registeredCustomDetectors.push(detector);
  }
}

/**
 * Resets all runtime registered key patterns, value patterns, exclusions, and custom detectors.
 * Restores the redactor engine to its default built-in configuration.
 */
export function resetCustomSecretPatterns(): void {
  registeredKeyPatterns = [];
  registeredValuePatterns = [];
  registeredExcludedKeyPatterns = [];
  registeredCustomDetectors = [];
}

/**
 * Retrieves a snapshot of the active secret patterns (defaults and registered runtime additions).
 * Returns defensive copies so callers cannot mutate the internal state directly.
 */
export function getSecretPatterns(): {
  defaultKeyPatterns: RegExp[];
  defaultValuePatterns: RegExp[];
  registeredKeyPatterns: RegExp[];
  registeredValuePatterns: RegExp[];
  registeredExcludedKeyPatterns: RegExp[];
} {
  return {
    defaultKeyPatterns: [...DEFAULT_SECRET_KEY_PATTERNS],
    defaultValuePatterns: [...DEFAULT_SECRET_VALUE_PATTERNS],
    registeredKeyPatterns: [...registeredKeyPatterns],
    registeredValuePatterns: [...registeredValuePatterns],
    registeredExcludedKeyPatterns: [...registeredExcludedKeyPatterns]
  };
}

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
export function isSecretKey(key: string, options?: RedactorOptions): boolean {
  if (!key || typeof key !== "string" || isPrototypePollutionKey(key)) return false;

  // 1. Check exclusions (options, registered, env)
  const excludePatterns: RegExp[] = [
    ...registeredExcludedKeyPatterns,
    ...(options?.excludeKeyPatterns || []).map(normalizePattern),
    ...parseEnvPatterns(process.env.SMCP_EXCLUDE_SECRET_KEYS)
  ];
  if (excludePatterns.some((pattern) => pattern.test(key))) {
    return false;
  }

  // 2. Check defaults
  if (DEFAULT_SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return true;
  }

  // 3. Check registered runtime patterns
  if (registeredKeyPatterns.some((pattern) => pattern.test(key))) {
    return true;
  }

  // 4. Check options extraKeyPatterns
  if (options?.extraKeyPatterns) {
    const extraPatterns = options.extraKeyPatterns.map(normalizePattern);
    if (extraPatterns.some((pattern) => pattern.test(key))) {
      return true;
    }
  }

  // 5. Check environment variable patterns
  const envPatterns = parseEnvPatterns(process.env.SMCP_EXTRA_SECRET_KEYS);
  if (envPatterns.some((pattern) => pattern.test(key))) {
    return true;
  }

  return false;
}

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
export function isSecretValue(value: string, options?: RedactorOptions): boolean {
  if (!value || typeof value !== "string") return false;

  if (CONNECTION_STRING_PATTERN.test(value)) {
    return true;
  }

  // 1. Check defaults
  if (DEFAULT_SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }

  // 2. Check registered runtime patterns
  if (registeredValuePatterns.some((pattern) => pattern.test(value))) {
    return true;
  }

  // 3. Check options extraValuePatterns
  if (options?.extraValuePatterns) {
    const extraPatterns = options.extraValuePatterns.map(normalizePattern);
    if (extraPatterns.some((pattern) => pattern.test(value))) {
      return true;
    }
  }

  // 4. Check environment variable patterns
  const envPatterns = parseEnvPatterns(process.env.SMCP_EXTRA_SECRET_VALUES);
  if (envPatterns.some((pattern) => pattern.test(value))) {
    return true;
  }

  return false;
}

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
export function detectSecret(
  context: SecretDetectionContext,
  options?: RedactorOptions
): SecretDetectionResult {
  const { key, value } = context;

  // 1. Run custom detectors (both passed in options and registered globally)
  const detectors = [
    ...registeredCustomDetectors,
    ...(options?.customDetectors || [])
  ];

  for (const detector of detectors) {
    try {
      const res = detector(context);
      if (typeof res === "boolean") {
        if (res) {
          return { isSecret: true };
        }
      } else if (res && typeof res === "object" && res.isSecret) {
        return res;
      }
    } catch {
      // Ignore detector errors to avoid crashing redaction
    }
  }

  // 2. Key-based check
  if (key && isSecretKey(key, options)) {
    return { isSecret: true };
  }

  // 3. Value-based check
  if (value && isSecretValue(value, options)) {
    return { isSecret: true };
  }

  return { isSecret: false };
}

/**
 * Generates a POSIX-compliant environment variable prefix based on an MCP server name.
 * Sanitizes non-alphanumeric characters to underscores and ensures the prefix does not begin with a digit.
 *
 * @param serverName - The name of the server (e.g., "1password", "my-github-api").
 * @returns A safe uppercase string suitable for env var naming (e.g. "_1PASSWORD", "MY_GITHUB_API").
 */
export function getSafePrefix(serverName: string): string {
  let sanitized = serverName.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
  if (!sanitized) {
    sanitized = "SERVER";
  }
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }
  return sanitized;
}

/**
 * Checks whether a URL contains embedded credentials in its authority section (user:pass@host)
 * or in query parameters matching known secret keys or token values.
 *
 * @param url - The remote server URL to inspect.
 * @param options - Optional redactor configuration.
 * @returns True if credentials or secrets are found within the URL.
 */
export function urlContainsCredentials(url: string, options?: RedactorOptions): boolean {
  if (CONNECTION_STRING_PATTERN.test(url) || isSecretValue(url, options)) {
    return true;
  }
  if (/^[a-zA-Z0-9+]+:\/\/[^/@]+@/.test(url)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      return true;
    }
    for (const [key, val] of parsed.searchParams.entries()) {
      if (isSecretKey(key, options) || isSecretValue(val, options)) {
        return true;
      }
    }
  } catch {
    // If not a parseable URL, authority check above already ran
  }
  return false;
}
