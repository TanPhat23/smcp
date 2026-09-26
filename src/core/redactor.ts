import type { McpServerConfig, RequiredEnv } from "../types.ts";

const SECRET_KEY_PATTERNS = [
  /TOKEN/i,
  /SECRET/i,
  /KEY/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /AUTH/i,
  /PRIVATE/i
];

const SECRET_VALUE_PATTERNS = [
  /^ghp_[a-zA-Z0-9]{36}$/,          // GitHub PAT
  /^github_pat_[a-zA-Z0-9_]{82}$/,  // GitHub Fine-grained PAT
  /^sk-[a-zA-Z0-9_-]{20,}$/,        // OpenAI/Anthropic keys
  /^ey[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/ // JWT token
];

const CONNECTION_STRING_PATTERN = /^[a-zA-Z0-9+]+:\/\/[^:]+:[^@]+@.+/;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function isSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export function redactMcpServers(servers: Record<string, McpServerConfig>): {
  redactedServers: Record<string, McpServerConfig>;
  requiredEnv: RequiredEnv[];
} {
  const redacted: Record<string, McpServerConfig> = {};
  const requiredEnvMap = new Map<string, RequiredEnv>();

  for (const [serverName, config] of Object.entries(servers)) {
    const updatedConfig: McpServerConfig = { ...config };

    // 1. Redact env object
    if (config.env) {
      const updatedEnv: Record<string, string> = {};
      for (const [envKey, envVal] of Object.entries(config.env)) {
        if (envVal.startsWith("${") && envVal.endsWith("}")) {
          // Already templated
          updatedEnv[envKey] = envVal;
          const varName = envVal.slice(2, -1);
          requiredEnvMap.set(varName, {
            key: varName,
            description: `Environment variable for ${serverName}`,
            isSecret: isSecretKey(envKey) || isSecretKey(varName) || isSecretValue(envVal)
          });
        } else if (isSecretKey(envKey) || isSecretValue(envVal)) {
          const placeholder = `\${${envKey}}`;
          updatedEnv[envKey] = placeholder;
          requiredEnvMap.set(envKey, {
            key: envKey,
            description: `Secret credential for ${serverName} (${envKey})`,
            isSecret: true
          });
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
        if (arg.startsWith("${") && arg.endsWith("}")) {
          const varName = arg.slice(2, -1);
          updatedArgs.push(arg);
          requiredEnvMap.set(varName, {
            key: varName,
            description: `Argument parameter for ${serverName}`,
            isSecret: isSecretKey(varName)
          });
        } else if (CONNECTION_STRING_PATTERN.test(arg)) {
          const safePrefix = serverName.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
          const envKey = `${safePrefix}_DATABASE_URL`;
          updatedArgs.push(`\${${envKey}}`);
          requiredEnvMap.set(envKey, {
            key: envKey,
            description: `Connection string for ${serverName}`,
            isSecret: true
          });
        } else if (isSecretValue(arg)) {
          const safePrefix = serverName.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
          const envKey = `${safePrefix}_API_KEY`;
          updatedArgs.push(`\${${envKey}}`);
          requiredEnvMap.set(envKey, {
            key: envKey,
            description: `API Key for ${serverName}`,
            isSecret: true
          });
        } else {
          updatedArgs.push(arg);
        }
      }
      updatedConfig.args = updatedArgs;
    }

    redacted[serverName] = updatedConfig;
  }

  return {
    redactedServers: redacted,
    requiredEnv: Array.from(requiredEnvMap.values())
  };
}
