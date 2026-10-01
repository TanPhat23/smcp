import type { McpServerConfig, RedactorOptions, RequiredEnv } from "../../types/index.ts";
import {
  CONNECTION_STRING_PATTERN,
  detectSecret,
  isSecretKey,
  isSecretValue,
  SINGLE_PLACEHOLDER_REGEX
} from "./detect.ts";

/**
 * Checks if a URL string contains embedded user:password credentials.
 * Example: `https://user:secret@example.com/sse`
 */
function urlContainsCredentials(url: string, options?: RedactorOptions): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      return true;
    }
    // Inspect query search parameters for secret keys or token values
    for (const [paramKey, paramVal] of parsed.searchParams.entries()) {
      if (isSecretKey(paramKey, options) || isSecretValue(paramVal, options)) {
        return true;
      }
    }
    // Inspect hash fragment (e.g. OAuth tokens #token=ghp_... or #access_token=...)
    if (parsed.hash && parsed.hash.length > 1) {
      try {
        const hashParams = new URLSearchParams(parsed.hash.slice(1));
        for (const [paramKey, paramVal] of hashParams.entries()) {
          if (isSecretKey(paramKey, options) || isSecretValue(paramVal, options)) {
            return true;
          }
        }
      } catch {
        // Ignore hash parsing errors
      }
    }
  } catch {
    // If not a valid standard URL, fallback to connection string pattern
    if (CONNECTION_STRING_PATTERN.test(url)) {
      return true;
    }
  }
  return isSecretValue(url, options);
}

/**
 * Generates an uppercase, POSIX-compliant environment variable prefix for a server name.
 * e.g. "my-db-server" -> "MY_DB_SERVER", "1password" -> "_1PASSWORD"
 */
function getSafePrefix(serverName: string): string {
  let clean = serverName.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!clean || /^[0-9]/.test(clean)) {
    clean = `_${clean}`;
  }
  return clean;
}

/**
 * Scans and redacts sensitive credentials inside MCP server configurations.
 * Inspects `env`, `args`, `command` (both string and array formats), and `url` fields.
 * Replaces detected secrets with `${VARIABLE_NAME}` environment placeholders
 * and compiles the corresponding list of `requiredEnv` definitions.
 *
 * @param servers - Dictionary of MCP server configurations.
 * @param options - Optional pattern detection overrides and filters.
 * @returns Redacted configurations and compiled requiredEnv definitions.
 */
export function redactMcpServers(
  servers: Record<string, McpServerConfig>,
  options?: RedactorOptions
): {
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

    // 0. Redact command (string or array formats)
    const rawCommand = (config as Record<string, unknown>).command;
    if (typeof rawCommand === "string") {
      let cmdStr = rawCommand;

      // Check for embedded connection strings with credentials
      const connMatch = cmdStr.match(/([a-zA-Z0-9+]+:\/\/[^:\s"']*:[^@\s"']+@[^\s"']+)/);
      if (connMatch) {
        const fullConn = connMatch[1];
        const baseKey = `${safePrefix}_DATABASE_URL`;
        const envKey = getNextArgKey(baseKey);
        cmdStr = cmdStr.replace(fullConn, `\${${envKey}}`);
        setRequiredEnv(envKey, `Connection string for ${serverName}`, true);
      }

      // Check for --flag=value patterns inside command string (supporting quotes)
      const flagEqRegex = /(--[a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
      cmdStr = cmdStr.replace(flagEqRegex, (match, flag, valDouble, valSingle, valBare) => {
        const val = valDouble ?? valSingle ?? valBare ?? "";
        const cleanFlag = flag.replace(/^--/, "");
        if (isSecretKey(cleanFlag, options) || isSecretValue(val, options)) {
          const baseKey = `${safePrefix}_${cleanFlag.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
          const envKey = getNextArgKey(baseKey);
          setRequiredEnv(envKey, `Secret credential for ${serverName} (${cleanFlag})`, true);
          return `${flag}=\${${envKey}}`;
        }
        return match;
      });

      // Check for --flag value space-separated pairs (supporting quotes)
      const flagSpaceRegex = /(--[a-zA-Z0-9_-]+)\s+(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
      cmdStr = cmdStr.replace(flagSpaceRegex, (match, flag, valDouble, valSingle, valBare) => {
        const val = valDouble ?? valSingle ?? valBare ?? "";
        const cleanFlag = flag.replace(/^--/, "");
        if (
          !val.startsWith("-") &&
          !val.startsWith("${") &&
          (isSecretKey(cleanFlag, options) || isSecretValue(val, options))
        ) {
          const baseKey = `${safePrefix}_${cleanFlag.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
          const envKey = getNextArgKey(baseKey);
          setRequiredEnv(envKey, `Secret credential for ${serverName} (${cleanFlag})`, true);
          return `${flag} \${${envKey}}`;
        }
        return match;
      });

      updatedConfig.command = cmdStr;
    } else if (Array.isArray(rawCommand)) {
      const cmdArr = [...rawCommand];
      const updatedCmdArr: (string | unknown)[] = [];
      for (let i = 0; i < cmdArr.length; i++) {
        const item = cmdArr[i];
        if (typeof item !== "string") {
          updatedCmdArr.push(item);
          continue;
        }

        const placeholderMatch = item.match(SINGLE_PLACEHOLDER_REGEX);
        if (placeholderMatch) {
          const varName = placeholderMatch[1];
          updatedCmdArr.push(item);
          setRequiredEnv(varName, `Command parameter for ${serverName}`, isSecretKey(varName, options));
          continue;
        }

        if (CONNECTION_STRING_PATTERN.test(item)) {
          const baseKey = `${safePrefix}_DATABASE_URL`;
          const envKey = getNextArgKey(baseKey);
          updatedCmdArr.push(`\${${envKey}}`);
          setRequiredEnv(envKey, `Connection string for ${serverName}`, true);
          continue;
        }

        const eqIdx = item.indexOf("=");
        if (eqIdx > 0 && (item.startsWith("-") || item.startsWith("--"))) {
          const flagKey = item.slice(0, eqIdx);
          const flagVal = item.slice(eqIdx + 1);
          const cleanFlag = flagKey.replace(/^-+/, "");

          if (CONNECTION_STRING_PATTERN.test(flagVal)) {
            const baseKey = `${safePrefix}_DATABASE_URL`;
            const envKey = getNextArgKey(baseKey);
            updatedCmdArr.push(`${flagKey}=\${${envKey}}`);
            setRequiredEnv(envKey, `Connection string for ${serverName}`, true);
            continue;
          }

          if (isSecretKey(cleanFlag, options) || isSecretValue(flagVal, options)) {
            const baseKey = `${safePrefix}_${cleanFlag.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
            const envKey = getNextArgKey(baseKey);
            updatedCmdArr.push(`${flagKey}=\${${envKey}}`);
            setRequiredEnv(envKey, `Secret credential for ${serverName} (${cleanFlag})`, true);
            continue;
          }
        }

        if (item.startsWith("-") && i + 1 < cmdArr.length && typeof cmdArr[i + 1] === "string") {
          const nextVal = cmdArr[i + 1] as string;
          const cleanFlag = item.replace(/^-+/, "");
          if (
            isSecretKey(cleanFlag, options) &&
            !nextVal.startsWith("-") &&
            !nextVal.startsWith("${")
          ) {
            updatedCmdArr.push(item);
            if (CONNECTION_STRING_PATTERN.test(nextVal)) {
              const baseKey = `${safePrefix}_DATABASE_URL`;
              const envKey = getNextArgKey(baseKey);
              updatedCmdArr.push(`\${${envKey}}`);
              setRequiredEnv(envKey, `Connection string for ${serverName}`, true);
            } else {
              const baseKey = `${safePrefix}_API_KEY`;
              const envKey = getNextArgKey(baseKey);
              updatedCmdArr.push(`\${${envKey}}`);
              setRequiredEnv(envKey, `Secret credential for ${serverName} (${cleanFlag})`, true);
            }
            i++;
            continue;
          }
        }

        const detection = detectSecret({ value: item, serverName, source: "arg" }, options);
        if (detection.isSecret || isSecretValue(item, options)) {
          const baseKey = detection.suggestedKey || `${safePrefix}_API_KEY`;
          const envKey = getNextArgKey(baseKey);
          updatedCmdArr.push(`\${${envKey}}`);
          setRequiredEnv(envKey, detection.description || `API Key for ${serverName}`, true);
        } else {
          updatedCmdArr.push(item);
        }
      }
      updatedConfig.command = updatedCmdArr as any;
    }

    // 1. Redact env / environment object
    const envSource = config.env || (config as Record<string, unknown>).environment;
    if (envSource && typeof envSource === "object" && !Array.isArray(envSource)) {
      const updatedEnv: Record<string, string> = {};
      for (const [envKey, rawVal] of Object.entries(envSource as Record<string, unknown>)) {
        const envVal = String(rawVal ?? "");
        const placeholderMatch = envVal.match(SINGLE_PLACEHOLDER_REGEX);
        if (placeholderMatch) {
          // Already templated
          updatedEnv[envKey] = envVal;
          const varName = placeholderMatch[1];
          const detection = detectSecret(
            { key: envKey, value: envVal, serverName, source: "env" },
            options
          );
          setRequiredEnv(
            varName,
            detection.description || `Environment variable for ${serverName}`,
            detection.isSecret || isSecretKey(envKey, options) || isSecretKey(varName, options) || isSecretValue(envVal, options)
          );
        } else {
          const detection = detectSecret(
            { key: envKey, value: envVal, serverName, source: "env" },
            options
          );
          if (detection.isSecret || isSecretKey(envKey, options) || isSecretValue(envVal, options)) {
            const placeholder = `\${${envKey}}`;
            updatedEnv[envKey] = placeholder;
            setRequiredEnv(
              envKey,
              detection.description || `Secret credential for ${serverName} (${envKey})`,
              true
            );
          } else {
            updatedEnv[envKey] = envVal;
          }
        }
      }
      if (config.env) {
        updatedConfig.env = updatedEnv;
      }
      if ((config as Record<string, unknown>).environment) {
        (updatedConfig as Record<string, unknown>).environment = updatedEnv;
      }
    }

    // 2. Redact args (e.g. database connection strings or tokens)
    if (config.args) {
      const updatedArgs: string[] = [];
      for (let i = 0; i < config.args.length; i++) {
        const arg = config.args[i];
        if (typeof arg !== "string") {
          updatedArgs.push(arg);
          continue;
        }

        const placeholderMatch = arg.match(SINGLE_PLACEHOLDER_REGEX);
        if (placeholderMatch) {
          const varName = placeholderMatch[1];
          updatedArgs.push(arg);
          setRequiredEnv(
            varName,
            `Argument parameter for ${serverName}`,
            isSecretKey(varName, options)
          );
          continue;
        }

        if (CONNECTION_STRING_PATTERN.test(arg)) {
          const baseKey = `${safePrefix}_DATABASE_URL`;
          const envKey = getNextArgKey(baseKey);
          updatedArgs.push(`\${${envKey}}`);
          setRequiredEnv(
            envKey,
            `Connection string for ${serverName}`,
            true
          );
          continue;
        }

        const eqIdx = arg.indexOf("=");
        if (eqIdx > 0 && (arg.startsWith("-") || arg.startsWith("--"))) {
          const flagKey = arg.slice(0, eqIdx);
          const flagVal = arg.slice(eqIdx + 1);
          const cleanFlag = flagKey.replace(/^-+/, "");

          if (CONNECTION_STRING_PATTERN.test(flagVal)) {
            const baseKey = `${safePrefix}_DATABASE_URL`;
            const envKey = getNextArgKey(baseKey);
            updatedArgs.push(`${flagKey}=\${${envKey}}`);
            setRequiredEnv(envKey, `Connection string for ${serverName}`, true);
            continue;
          }

          if (isSecretKey(cleanFlag, options) || isSecretValue(flagVal, options)) {
            const baseKey = `${safePrefix}_${cleanFlag.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
            const envKey = getNextArgKey(baseKey);
            updatedArgs.push(`${flagKey}=\${${envKey}}`);
            setRequiredEnv(
              envKey,
              `Secret credential for ${serverName} (${cleanFlag})`,
              true
            );
            continue;
          }
        }

        if (arg.startsWith("-") && i + 1 < config.args.length && typeof config.args[i + 1] === "string") {
          const nextVal = config.args[i + 1];
          const cleanFlag = arg.replace(/^-+/, "");
          if (
            isSecretKey(cleanFlag, options) &&
            !nextVal.startsWith("-") &&
            !nextVal.startsWith("${")
          ) {
            updatedArgs.push(arg);
            if (CONNECTION_STRING_PATTERN.test(nextVal)) {
              const baseKey = `${safePrefix}_DATABASE_URL`;
              const envKey = getNextArgKey(baseKey);
              updatedArgs.push(`\${${envKey}}`);
              setRequiredEnv(envKey, `Connection string for ${serverName}`, true);
            } else {
              const baseKey = `${safePrefix}_API_KEY`;
              const envKey = getNextArgKey(baseKey);
              updatedArgs.push(`\${${envKey}}`);
              setRequiredEnv(
                envKey,
                `Secret credential for ${serverName} (${cleanFlag})`,
                true
              );
            }
            i++;
            continue;
          }
        }

        const argDetection = detectSecret(
          { value: arg, serverName, source: "arg" },
          options
        );
        if (argDetection.isSecret || isSecretValue(arg, options)) {
          const baseKey = argDetection.suggestedKey || `${safePrefix}_API_KEY`;
          const envKey = getNextArgKey(baseKey);
          updatedArgs.push(`\${${envKey}}`);
          setRequiredEnv(
            envKey,
            argDetection.description || `API Key for ${serverName}`,
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
          isSecretKey(varName, options)
        );
      } else {
        const urlDetection = detectSecret(
          { value: config.url, serverName, source: "url" },
          options
        );
        if (urlDetection.isSecret || urlContainsCredentials(config.url, options)) {
          const envKey = `${safePrefix}_URL`;
          updatedConfig.url = `\${${envKey}}`;
          setRequiredEnv(
            envKey,
            urlDetection.description || `URL for ${serverName}`,
            true
          );
        } else {
          updatedConfig.url = config.url;
        }
      }
    }

    // 4. Redact headers (e.g. Authorization Bearer tokens, x-api-key for remote MCP servers)
    const rawHeaders = (config as Record<string, unknown>).headers;
    if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
      const updatedHeaders: Record<string, string> = {};
      for (const [headerKey, headerVal] of Object.entries(rawHeaders)) {
        if (typeof headerVal !== "string") {
          updatedHeaders[headerKey] = headerVal as any;
          continue;
        }

        const placeholderMatch = headerVal.match(SINGLE_PLACEHOLDER_REGEX);
        if (placeholderMatch) {
          const varName = placeholderMatch[1];
          updatedHeaders[headerKey] = headerVal;
          setRequiredEnv(
            varName,
            `Header credential for ${serverName} (${headerKey})`,
            isSecretKey(varName, options) || isSecretKey(headerKey, options)
          );
          continue;
        }

        const isAuthBearer = headerVal.startsWith("Bearer ");
        const tokenCandidate = isAuthBearer ? headerVal.slice(7).trim() : headerVal;

        const isSensitive =
          headerKey.toLowerCase() === "authorization" ||
          isSecretKey(headerKey, options) ||
          isSecretValue(headerVal, options) ||
          (isAuthBearer && (isSecretValue(tokenCandidate, options) || tokenCandidate.length >= 10));

        if (isSensitive) {
          const cleanKey = headerKey.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
          const baseKey = `${safePrefix}_${cleanKey}`;
          const envKey = getNextArgKey(baseKey);

          if (isAuthBearer) {
            updatedHeaders[headerKey] = `Bearer \${${envKey}}`;
          } else {
            updatedHeaders[headerKey] = `\${${envKey}}`;
          }
          setRequiredEnv(
            envKey,
            `Secret header for ${serverName} (${headerKey})`,
            true
          );
        } else {
          updatedHeaders[headerKey] = headerVal;
        }
      }
      (updatedConfig as any).headers = updatedHeaders;
    }

    redacted[serverName] = updatedConfig;
  }

  return {
    redactedServers: redacted,
    requiredEnv: Array.from(requiredEnvMap.values())
  };
}
