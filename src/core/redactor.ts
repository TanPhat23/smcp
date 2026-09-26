import type { McpServerConfig, RequiredEnv } from "../types.ts";

const SECRET_KEY_PATTERNS = [
  /TOKEN/i,
  /SECRET/i,
  /KEY/i,
  /PASSWORD/i,
  /PASSWD/i,
  /PASS/i,
  /PASSPHRASE/i,
  /CREDENTIAL/i,
  /AUTH/i,
  /PRIVATE/i
];

const SECRET_VALUE_PATTERNS = [
  /^ghp_[a-zA-Z0-9]{36}$/,          // GitHub PAT
  /^github_pat_[a-zA-Z0-9_]{82}$/,  // GitHub Fine-grained PAT
  /^sk[_-][a-zA-Z0-9_-]{20,}$/,     // OpenAI / Anthropic / Stripe keys
  /^xoxb-[a-zA-Z0-9_-]+/,           // Slack bot token
  /^hf_[a-zA-Z0-9]+/,               // HuggingFace token
  /^ey[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/ // JWT token
];

export const CONNECTION_STRING_PATTERN = /^[a-zA-Z0-9+]+:\/\/[^:]*:[^@]+@.+/;

export const SINGLE_PLACEHOLDER_REGEX = /^\${([a-zA-Z_][a-zA-Z0-9_]*)}$/;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function isSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)) || CONNECTION_STRING_PATTERN.test(value);
}

function getSafePrefix(serverName: string): string {
  let sanitized = serverName.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
  if (!sanitized) {
    sanitized = "SERVER";
  }
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }
  return sanitized;
}

function urlContainsCredentials(url: string): boolean {
  if (CONNECTION_STRING_PATTERN.test(url) || isSecretValue(url)) {
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
      if (isSecretKey(key) || isSecretValue(val)) {
        return true;
      }
    }
  } catch {
    // If not a parseable URL, authority check above already ran
  }
  return false;
}

export function redactMcpServers(servers: Record<string, McpServerConfig>): {
  redactedServers: Record<string, McpServerConfig>;
  requiredEnv: RequiredEnv[];
} {
  const redacted: Record<string, McpServerConfig> = {};
  const requiredEnvMap = new Map<string, RequiredEnv>();

  const setRequiredEnv = (key: string, description: string, newIsSecret: boolean) => {
    const existing = requiredEnvMap.get(key);
    requiredEnvMap.set(key, {
      key,
      description: existing?.description || description,
      isSecret: existing?.isSecret || newIsSecret
    });
  };

  for (const [serverName, config] of Object.entries(servers)) {
    const updatedConfig: McpServerConfig = { ...config };
    const safePrefix = getSafePrefix(serverName);
    const generatedArgKeys = new Map<string, number>();

    const getNextArgKey = (baseKey: string): string => {
      const count = (generatedArgKeys.get(baseKey) || 0) + 1;
      generatedArgKeys.set(baseKey, count);
      return count === 1 ? baseKey : `${baseKey}_${count}`;
    };

    // 1. Redact env object
    if (config.env) {
      const updatedEnv: Record<string, string> = {};
      for (const [envKey, envVal] of Object.entries(config.env)) {
        const placeholderMatch = envVal.match(SINGLE_PLACEHOLDER_REGEX);
        if (placeholderMatch) {
          // Already templated
          updatedEnv[envKey] = envVal;
          const varName = placeholderMatch[1];
          setRequiredEnv(
            varName,
            `Environment variable for ${serverName}`,
            isSecretKey(envKey) || isSecretKey(varName) || isSecretValue(envVal)
          );
        } else if (isSecretKey(envKey) || isSecretValue(envVal)) {
          const placeholder = `\${${envKey}}`;
          updatedEnv[envKey] = placeholder;
          setRequiredEnv(
            envKey,
            `Secret credential for ${serverName} (${envKey})`,
            true
          );
        } else {
          updatedEnv[envKey] = envVal;
        }
      }
      updatedConfig.env = updatedEnv;
    }

    // 2. Redact args (e.g. database connection strings or tokens)
    if (config.args) {
      const updatedArgs: string[] = [];
      for (const arg of config.args) {
        const placeholderMatch = arg.match(SINGLE_PLACEHOLDER_REGEX);
        if (placeholderMatch) {
          const varName = placeholderMatch[1];
          updatedArgs.push(arg);
          setRequiredEnv(
            varName,
            `Argument parameter for ${serverName}`,
            isSecretKey(varName)
          );
        } else if (CONNECTION_STRING_PATTERN.test(arg)) {
          const baseKey = `${safePrefix}_DATABASE_URL`;
          const envKey = getNextArgKey(baseKey);
          updatedArgs.push(`\${${envKey}}`);
          setRequiredEnv(
            envKey,
            `Connection string for ${serverName}`,
            true
          );
        } else if (isSecretValue(arg)) {
          const baseKey = `${safePrefix}_API_KEY`;
          const envKey = getNextArgKey(baseKey);
          updatedArgs.push(`\${${envKey}}`);
          setRequiredEnv(
            envKey,
            `API Key for ${serverName}`,
            true
          );
        } else {
          updatedArgs.push(arg);
        }
      }
      updatedConfig.args = updatedArgs;
    }

    // 3. Redact url (e.g. SSE / HTTP remote MCP servers)
    if (config.url) {
      const placeholderMatch = config.url.match(SINGLE_PLACEHOLDER_REGEX);
      if (placeholderMatch) {
        const varName = placeholderMatch[1];
        updatedConfig.url = config.url;
        setRequiredEnv(
          varName,
          `URL for ${serverName}`,
          isSecretKey(varName)
        );
      } else if (urlContainsCredentials(config.url)) {
        const envKey = `${safePrefix}_URL`;
        updatedConfig.url = `\${${envKey}}`;
        setRequiredEnv(
          envKey,
          `URL for ${serverName}`,
          true
        );
      } else {
        updatedConfig.url = config.url;
      }
    }

    redacted[serverName] = updatedConfig;
  }

  return {
    redactedServers: redacted,
    requiredEnv: Array.from(requiredEnvMap.values())
  };
}
