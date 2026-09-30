import { describe, expect, it } from "bun:test";
import {
  getSecretPatterns,
  isSecretKey,
  isSecretValue,
  normalizePattern,
  redactMcpServers,
  registerCustomDetector,
  registerExcludedKeyPatterns,
  registerSecretKeyPatterns,
  registerSecretValuePatterns,
  resetCustomSecretPatterns,
  urlContainsCredentials
} from "../packages/core/src/core/redactor/index.ts";
import type { McpServerConfig } from "../packages/core/src/types/index.ts";

describe("Secret Redactor Engine", () => {
  it("replaces sensitive env vars with placeholders", () => {
    const servers: Record<string, McpServerConfig> = {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_1234567890abcdef"
        }
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);

    expect(redactedServers.github.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("${GITHUB_PERSONAL_ACCESS_TOKEN}");
    expect(requiredEnv).toHaveLength(1);
    expect(requiredEnv[0].key).toBe("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(requiredEnv[0].isSecret).toBe(true);
  });

  it("redacts credentials inside connection string args", () => {
    const servers: Record<string, McpServerConfig> = {
      postgres: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:secretpw@localhost:5432/mydb"]
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);

    expect(redactedServers.postgres.args?.[2]).toBe("${POSTGRES_DATABASE_URL}");
    expect(requiredEnv.some(e => e.key === "POSTGRES_DATABASE_URL")).toBe(true);
  });

  it("preserves non-secret environment variables and safe args", () => {
    const servers: Record<string, McpServerConfig> = {
      local: {
        command: "node",
        args: ["server.js", "--port", "3000"],
        env: {
          NODE_ENV: "production"
        }
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);
    expect(redactedServers.local.env?.NODE_ENV).toBe("production");
    expect(requiredEnv).toHaveLength(0);
  });

  it("handles existing placeholders without double redaction", () => {
    const servers: Record<string, McpServerConfig> = {
      api: {
        command: "node",
        args: ["start", "${MY_CUSTOM_FLAG}"],
        env: {
          API_KEY: "${EXISTING_SECRET_KEY}"
        }
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);
    expect(redactedServers.api.env?.API_KEY).toBe("${EXISTING_SECRET_KEY}");
    expect(redactedServers.api.args?.[1]).toBe("${MY_CUSTOM_FLAG}");
    expect(requiredEnv.some(e => e.key === "EXISTING_SECRET_KEY")).toBe(true);
  });

  it("identifies secret keys correctly", () => {
    expect(isSecretKey("GITHUB_TOKEN")).toBe(true);
    expect(isSecretKey("CLIENT_SECRET")).toBe(true);
    expect(isSecretKey("API_KEY")).toBe(true);
    expect(isSecretKey("DB_PASSWORD")).toBe(true);
    expect(isSecretKey("USER_PASSWD")).toBe(true);
    expect(isSecretKey("AWS_CREDENTIALS")).toBe(true);
    expect(isSecretKey("AUTH_HEADER")).toBe(true);
    expect(isSecretKey("PRIVATE_KEY_PATH")).toBe(true);
    expect(isSecretKey("PASS")).toBe(true);
    expect(isSecretKey("PASSPHRASE")).toBe(true);
    expect(isSecretKey("USER_PASS")).toBe(true);
    expect(isSecretKey("SSH_PASSPHRASE")).toBe(true);
    expect(isSecretKey("PORT")).toBe(false);
    expect(isSecretKey("NODE_ENV")).toBe(false);
    expect(isSecretKey("HOST")).toBe(false);
  });

  it("identifies secret values correctly", () => {
    // GitHub PAT (36 hex/alphanumeric chars after ghp_)
    expect(isSecretValue("ghp_" + "a".repeat(36))).toBe(true);
    // GitHub fine-grained PAT (82 chars after github_pat_)
    expect(isSecretValue("github_pat_" + "a".repeat(82))).toBe(true);
    // OpenAI / Anthropic key
    expect(isSecretValue("sk-" + "a".repeat(30))).toBe(true);
    // Stripe key (sk_live_...)
    expect(isSecretValue("sk_live_" + "a".repeat(25))).toBe(true);
    // Slack bot token (xoxb-...)
    expect(isSecretValue("xoxb-1234567890-abcdef123456")).toBe(true);
    // HuggingFace token (hf_...)
    expect(isSecretValue("hf_" + "a".repeat(30))).toBe(true);
    // JWT token
    expect(isSecretValue("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")).toBe(true);
    // Normal values
    expect(isSecretValue("normal-value")).toBe(false);
    expect(isSecretValue("http://localhost:3000")).toBe(false);
  });

  it("redacts secret values even when key name does not match secret key pattern", () => {
    const servers: Record<string, McpServerConfig> = {
      ai: {
        command: "npx",
        args: ["server-ai"],
        env: {
          LLM_PARAM: "sk-" + "x".repeat(32)
        }
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);
    expect(redactedServers.ai.env?.LLM_PARAM).toBe("${LLM_PARAM}");
    expect(requiredEnv).toHaveLength(1);
    expect(requiredEnv[0].key).toBe("LLM_PARAM");
    expect(requiredEnv[0].isSecret).toBe(true);
  });

  it("redacts secret values inside command args", () => {
    const servers: Record<string, McpServerConfig> = {
      service: {
        command: "service-cli",
        args: ["--api-key", "sk-" + "k".repeat(32)]
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);
    expect(redactedServers.service.args?.[1]).toBe("${SERVICE_API_KEY}");
    expect(requiredEnv.some(e => e.key === "SERVICE_API_KEY" && e.isSecret)).toBe(true);
  });

  it("preserves servers without env or args and preserves extra passthrough properties", () => {
    const servers: Record<string, McpServerConfig> = {
      simple: {
        command: "simple-command",
        url: "http://localhost:8080/mcp"
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);
    expect(redactedServers.simple.command).toBe("simple-command");
    expect(redactedServers.simple.url).toBe("http://localhost:8080/mcp");
    expect(requiredEnv).toHaveLength(0);
  });

  it("preserves isSecret: true when url is a single placeholder with secret keyword in variable name", () => {
    const servers: Record<string, McpServerConfig> = {
      remote: {
        url: "${SECRET_REMOTE_TOKEN_URL}"
      }
    };
    const { redactedServers, requiredEnv } = redactMcpServers(servers);
    expect(redactedServers.remote.url).toBe("${SECRET_REMOTE_TOKEN_URL}");
    const secretEnv = requiredEnv.find((e) => e.key === "SECRET_REMOTE_TOKEN_URL");
    expect(secretEnv).toBeDefined();
    expect(secretEnv?.isSecret).toBe(true);
  });

  it("preserves isSecret: true for command parameter single placeholder with secret name", () => {
    const servers: Record<string, McpServerConfig> = {
      myTool: {
        command: ["my-tool", "${AUTH_TOKEN}"] as any
      }
    };
    const { requiredEnv } = redactMcpServers(servers);
    const tokenEnv = requiredEnv.find((e) => e.key === "AUTH_TOKEN");
    expect(tokenEnv).toBeDefined();
    expect(tokenEnv?.isSecret).toBe(true);
  });

  it("redacts database connection strings placed inside env", () => {
    const servers: Record<string, McpServerConfig> = {
      dbService: {
        command: "node",
        args: ["server.js"],
        env: {
          DATABASE_URL: "postgresql://postgres:secret@localhost:5432/db"
        }
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);
    expect(redactedServers.dbService.env?.DATABASE_URL).toBe("${DATABASE_URL}");
    expect(requiredEnv).toHaveLength(1);
    expect(requiredEnv[0].key).toBe("DATABASE_URL");
    expect(requiredEnv[0].isSecret).toBe(true);
  });

  it("redacts password-only connection strings", () => {
    expect(isSecretValue("redis://:password@localhost:6379")).toBe(true);

    const servers: Record<string, McpServerConfig> = {
      redisServer: {
        command: "redis-cli",
        args: ["-u", "redis://:mypassword@localhost:6379"],
        env: {
          CACHE_URL: "redis://:cachepassword@localhost:6379/0"
        }
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);
    expect(redactedServers.redisServer.args?.[1]).toBe("${REDISSERVER_DATABASE_URL}");
    expect(redactedServers.redisServer.env?.CACHE_URL).toBe("${CACHE_URL}");
    expect(requiredEnv.some(e => e.key === "REDISSERVER_DATABASE_URL" && e.isSecret)).toBe(true);
    expect(requiredEnv.some(e => e.key === "CACHE_URL" && e.isSecret)).toBe(true);
  });

  it("does not mutate the original input objects, env, or args arrays", () => {
    const originalArgs = ["--conn", "postgresql://postgres:secret@localhost:5432/db", "--safe"];
    const originalEnv = {
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/db",
      API_KEY: "sk-12345678901234567890",
      PORT: "3000"
    };
    const serverConfig: McpServerConfig = {
      command: "node",
      args: originalArgs,
      env: originalEnv
    };
    const servers: Record<string, McpServerConfig> = {
      dbApp: serverConfig
    };

    // Deep freeze input structures to trigger errors if any mutation is attempted
    Object.freeze(originalArgs);
    Object.freeze(originalEnv);
    Object.freeze(serverConfig);
    Object.freeze(servers);

    const { redactedServers } = redactMcpServers(servers);

    // Verify original arrays, objects, and configurations remain untouched
    expect(originalArgs[1]).toBe("postgresql://postgres:secret@localhost:5432/db");
    expect(originalEnv.DATABASE_URL).toBe("postgresql://postgres:secret@localhost:5432/db");
    expect(originalEnv.API_KEY).toBe("sk-12345678901234567890");
    expect(originalEnv.PORT).toBe("3000");

    // Verify redacted instances are new objects and arrays with redacted values
    expect(redactedServers.dbApp.args?.[1]).toBe("${DBAPP_DATABASE_URL}");
    expect(redactedServers.dbApp.env?.DATABASE_URL).toBe("${DATABASE_URL}");
    expect(redactedServers.dbApp.args).not.toBe(originalArgs);
    expect(redactedServers.dbApp.env).not.toBe(originalEnv);
    expect(redactedServers.dbApp).not.toBe(serverConfig);
    expect(redactedServers).not.toBe(servers);
  });

  it("ensures isSecret: true is not downgraded if the same var is referenced again", () => {
    // Case 1: First occurrence is secret, subsequent occurrence is non-secret
    const serversSecretFirst: Record<string, McpServerConfig> = {
      primary: {
        command: "node",
        env: {
          AUTH_TOKEN: "${SHARED_VAR}"
        }
      },
      secondary: {
        command: "node",
        args: ["${SHARED_VAR}"]
      },
      tertiary: {
        command: "node",
        env: {
          PUBLIC_PORT: "${SHARED_VAR}"
        }
      }
    };

    const result1 = redactMcpServers(serversSecretFirst);
    const sharedVar1 = result1.requiredEnv.find(e => e.key === "SHARED_VAR");
    expect(sharedVar1).toBeDefined();
    expect(sharedVar1?.isSecret).toBe(true);

    // Case 2: First occurrence is non-secret, subsequent occurrence is secret, later non-secret
    const serversSecretLater: Record<string, McpServerConfig> = {
      serverA: {
        command: "node",
        args: ["${CONFIG_VAR}"]
      },
      serverB: {
        command: "node",
        env: {
          SECRET_KEY: "${CONFIG_VAR}"
        }
      },
      serverC: {
        command: "node",
        args: ["${CONFIG_VAR}"]
      }
    };

    const result2 = redactMcpServers(serversSecretLater);
    const configVar = result2.requiredEnv.find(e => e.key === "CONFIG_VAR");
    expect(configVar).toBeDefined();
    expect(configVar?.isSecret).toBe(true);
  });

  it("redacts config.url with credentials to placeholder with isSecret: true", () => {
    const servers: Record<string, McpServerConfig> = {
      remoteService: {
        url: "https://user:password@mcp.internal/sse"
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);

    expect(redactedServers.remoteService.url).toBe("${REMOTESERVICE_URL}");
    const envEntry = requiredEnv.find(e => e.key === "REMOTESERVICE_URL");
    expect(envEntry).toBeDefined();
    expect(envEntry?.isSecret).toBe(true);
  });

  it("assigns distinct variable names to multiple secret arguments on the same server", () => {
    const servers: Record<string, McpServerConfig> = {
      postgres: {
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-postgres",
          "postgresql://user:secret1@localhost:5432/primary",
          "postgresql://user:secret2@localhost:5432/replica"
        ]
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);

    expect(redactedServers.postgres.args?.[2]).toBe("${POSTGRES_DATABASE_URL}");
    expect(redactedServers.postgres.args?.[3]).toBe("${POSTGRES_DATABASE_URL_2}");
    expect(requiredEnv.some(e => e.key === "POSTGRES_DATABASE_URL" && e.isSecret)).toBe(true);
    expect(requiredEnv.some(e => e.key === "POSTGRES_DATABASE_URL_2" && e.isSecret)).toBe(true);
  });

  it("does not naively slice composite template strings like ${HOST}:${PORT} into invalid variable names", () => {
    const servers: Record<string, McpServerConfig> = {
      compositeApp: {
        command: "node",
        args: ["--listen", "${HOST}:${PORT}"],
        env: {
          LISTEN_ADDR: "${HOST}:${PORT}",
          MULTI_VAR: "${FOO}_${BAR}"
        }
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);

    expect(redactedServers.compositeApp.args?.[1]).toBe("${HOST}:${PORT}");
    expect(redactedServers.compositeApp.env?.LISTEN_ADDR).toBe("${HOST}:${PORT}");
    expect(redactedServers.compositeApp.env?.MULTI_VAR).toBe("${FOO}_${BAR}");

    // Ensure no invalid variable names containing ':' or '}' or '{' were registered
    expect(requiredEnv.some(e => e.key.includes(":") || e.key.includes("}") || e.key.includes("{"))).toBe(false);
    expect(requiredEnv).toHaveLength(0);
  });

  it("generates POSIX-valid env var names for servers with leading digits", () => {
    const servers: Record<string, McpServerConfig> = {
      "1password": {
        command: "op-mcp",
        args: ["--api-key", "sk-" + "k".repeat(32)]
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers);

    expect(redactedServers["1password"].args?.[1]).toBe("${_1PASSWORD_API_KEY}");
    const envEntry = requiredEnv.find(e => e.key === "_1PASSWORD_API_KEY");
    expect(envEntry).toBeDefined();
    expect(envEntry?.isSecret).toBe(true);
  });
});

describe("Extensible Secret Patterns & AI Agent API", () => {
  it("normalizePattern parses RegExps, slash strings, wildcards, and literals", () => {
    // 1. RegExp passthrough
    const regex = /^CUSTOM_API_[0-9]+$/;
    expect(normalizePattern(regex)).toBe(regex);

    // 2. Slash-delimited regex string
    const slash = normalizePattern("/^token_[a-z0-9]+$/i");
    expect(slash.test("token_abc123")).toBe(true);
    expect(slash.test("TOKEN_XYZ")).toBe(true);
    expect(slash.test("other")).toBe(false);

    // 3. Glob wildcard strings
    const globPrefix = normalizePattern("MY_CORP_*");
    expect(globPrefix.test("MY_CORP_API_TOKEN")).toBe(true);
    expect(globPrefix.test("MY_CORP_")).toBe(true);
    expect(globPrefix.test("OTHER_CORP_API")).toBe(false);

    const globSuffix = normalizePattern("*_PRIVATE_HASH");
    expect(globSuffix.test("USER_PRIVATE_HASH")).toBe(true);
    expect(globSuffix.test("USER_PUBLIC_HASH")).toBe(false);

    // 4. Literal substring strings
    const literal = normalizePattern("INTERNAL_SIGNATURE");
    expect(literal.test("MY_INTERNAL_SIGNATURE_KEY")).toBe(true);
    expect(literal.test("internal_signature")).toBe(true);
    expect(literal.test("unrelated")).toBe(false);

    // 5. Empty / whitespace inputs do not throw
    expect(normalizePattern("").test("anything")).toBe(false);
    expect(normalizePattern("   ").test("anything")).toBe(false);
  });

  it("identifies modern expanded default secret values out-of-the-box", () => {
    // Google AI / Firebase keys (AIzaSy...)
    expect(isSecretValue("AIzaSy" + "A".repeat(33))).toBe(true);

    // AWS Access Key ID (AKIA... / ASIA...)
    expect(isSecretValue("AKIA1234567890ABCDEF")).toBe(true);
    expect(isSecretValue("ASIA1234567890ABCDEF")).toBe(true);

    // OpenAI project key
    expect(isSecretValue("sk-proj-" + "a".repeat(30))).toBe(true);

    // Anthropic key
    expect(isSecretValue("sk-ant-" + "a".repeat(30))).toBe(true);

    // Slack bot/user tokens (xoxp-, xoxa-, xoxr-)
    expect(isSecretValue("xoxp-123456789-abcdef")).toBe(true);
    expect(isSecretValue("xoxa-123456789-abcdef")).toBe(true);

    // Supabase tokens
    expect(isSecretValue("sbp_" + "a".repeat(35))).toBe(true);

    // GitLab PAT
    expect(isSecretValue("glpat-" + "a".repeat(25))).toBe(true);

    // NPM tokens
    expect(isSecretValue("npm_" + "a".repeat(36))).toBe(true);

    // Resend API keys
    expect(isSecretValue("re_" + "a".repeat(32))).toBe(true);
  });

  it("supports custom key and value patterns passed via RedactorOptions", () => {
    // Custom key pattern
    expect(isSecretKey("COMPANY_TENANT_ID")).toBe(false);
    expect(
      isSecretKey("COMPANY_TENANT_ID", {
        extraKeyPatterns: ["COMPANY_TENANT_ID"]
      })
    ).toBe(true);

    // Custom glob pattern
    expect(
      isSecretKey("ORG_SECRET_PARAM_1", {
        extraKeyPatterns: ["ORG_SECRET_*"]
      })
    ).toBe(true);

    // Custom value regex pattern
    expect(isSecretValue("acme-token-998877")).toBe(false);
    expect(
      isSecretValue("acme-token-998877", {
        extraValuePatterns: ["/^acme-token-[0-9]+$/"]
      })
    ).toBe(true);
  });

  it("supports excludeKeyPatterns for allowlisting false-positive keys", () => {
    // PUBLIC_KEY matches /KEY/ by default
    expect(isSecretKey("PUBLIC_KEY")).toBe(true);

    // Excluded via exact pattern
    expect(
      isSecretKey("PUBLIC_KEY", {
        excludeKeyPatterns: [/^PUBLIC_KEY$/]
      })
    ).toBe(false);

    // Excluded via glob pattern
    expect(
      isSecretKey("KEYBOARD_LAYOUT", {
        excludeKeyPatterns: ["KEYBOARD_*"]
      })
    ).toBe(false);
  });

  it("supports runtime pattern registration and resets", () => {
    resetCustomSecretPatterns();

    try {
      // 1. Initial clean state check
      expect(isSecretKey("DYNAMIC_AGENT_PARAM_ABC")).toBe(false);
      expect(isSecretValue("agent-vault-secret-123")).toBe(false);
      expect(isSecretKey(null as any)).toBe(false);
      expect(isSecretKey(undefined as any)).toBe(false);
      expect(isSecretKey(12345 as any)).toBe(false);
      expect(isSecretValue(null as any)).toBe(false);
      expect(isSecretValue(undefined as any)).toBe(false);
      expect(isSecretKey("__proto__")).toBe(false);
      expect(isSecretKey("constructor")).toBe(false);
      expect(isSecretKey("prototype")).toBe(false);

      // 2. Safe registration of valid patterns and ignoring invalid/pollution keys
      registerSecretKeyPatterns(
        "DYNAMIC_AGENT_PARAM_*",
        "/^slash-custom-[a-z]+$/i",
        "",
        "   ",
        null as any,
        undefined as any,
        "__proto__",
        "constructor"
      );
      registerSecretValuePatterns(
        /^agent-vault-secret-[0-9]+$/,
        null as any,
        "",
        "prototype"
      );
      registerExcludedKeyPatterns(
        "DYNAMIC_AGENT_PARAM_EXCLUDED",
        null as any,
        "__proto__"
      );

      // 3. Verify registered patterns match
      expect(isSecretKey("DYNAMIC_AGENT_PARAM_ABC")).toBe(true);
      expect(isSecretKey("DYNAMIC_AGENT_PARAM_XYZ")).toBe(true);
      expect(isSecretKey("slash-custom-blob")).toBe(true);
      expect(isSecretKey("unrelated_param")).toBe(false);
      expect(isSecretValue("agent-vault-secret-123")).toBe(true);
      expect(isSecretValue("agent-vault-secret-notnumber")).toBe(false);

      // 4. Verify exclusion precedence: exclusion wins over pattern match
      expect(isSecretKey("DYNAMIC_AGENT_PARAM_EXCLUDED")).toBe(false);

      // 5. Verify prototype pollution keys are not treated as secret keys
      expect(isSecretKey("__proto__")).toBe(false);
      expect(isSecretKey("constructor")).toBe(false);
      expect(isSecretKey("prototype")).toBe(false);

      // 6. Verify defensive copy of getSecretPatterns
      const patterns = getSecretPatterns();
      expect(patterns.registeredKeyPatterns.length).toBe(2);
      expect(patterns.registeredValuePatterns.length).toBe(1);
      expect(patterns.registeredExcludedKeyPatterns.length).toBe(1);

      // Mutating returned array must not pollute internal registry
      patterns.registeredKeyPatterns.push(/^POLLUTED_REGEX$/);
      expect(isSecretKey("POLLUTED_REGEX")).toBe(false);
      expect(getSecretPatterns().registeredKeyPatterns.length).toBe(2);

      // 7. Verify end-to-end redaction using runtime registered patterns
      const testServers: Record<string, McpServerConfig> = {
        runtimeApp: {
          command: "node",
          env: {
            DYNAMIC_AGENT_PARAM_ACTIVE: "secret-val-1",
            DYNAMIC_AGENT_PARAM_EXCLUDED: "public-val-2",
            UNTOUCHED_CONF: "safe"
          },
          args: ["--vault-ref", "agent-vault-secret-999"]
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(testServers);
      expect(redactedServers.runtimeApp.env?.DYNAMIC_AGENT_PARAM_ACTIVE).toBe("${DYNAMIC_AGENT_PARAM_ACTIVE}");
      expect(redactedServers.runtimeApp.env?.DYNAMIC_AGENT_PARAM_EXCLUDED).toBe("public-val-2");
      expect(redactedServers.runtimeApp.env?.UNTOUCHED_CONF).toBe("safe");
      expect(redactedServers.runtimeApp.args?.[1]).toBe("${RUNTIMEAPP_API_KEY}");
      expect(requiredEnv.some((e) => e.key === "DYNAMIC_AGENT_PARAM_ACTIVE" && e.isSecret)).toBe(true);
      expect(requiredEnv.some((e) => e.key === "DYNAMIC_AGENT_PARAM_EXCLUDED")).toBe(false);
      expect(requiredEnv.some((e) => e.key === "RUNTIMEAPP_API_KEY" && e.isSecret)).toBe(true);

      // 8. Reset and verify completely clean state
      resetCustomSecretPatterns();
      expect(isSecretKey("DYNAMIC_AGENT_PARAM_ABC")).toBe(false);
      expect(isSecretKey("slash-custom-blob")).toBe(false);
      expect(isSecretValue("agent-vault-secret-123")).toBe(false);

      const clearedPatterns = getSecretPatterns();
      expect(clearedPatterns.registeredKeyPatterns).toHaveLength(0);
      expect(clearedPatterns.registeredValuePatterns).toHaveLength(0);
      expect(clearedPatterns.registeredExcludedKeyPatterns).toHaveLength(0);
    } finally {
      resetCustomSecretPatterns();
    }
  });

  it("supports custom detector functions for dynamic contextual inspection", () => {
    const servers: Record<string, McpServerConfig> = {
      aiBackend: {
        command: "node",
        args: ["--vault-item", "custom-encrypted-blob-123"],
        env: {
          SAFE_FLAG: "true",
          CUSTOM_SECRET: "raw-val-xyz"
        }
      }
    };

    const customDetector = (context: any) => {
      if (context.key === "CUSTOM_SECRET") {
        return {
          isSecret: true,
          description: "Custom AI Agent Secret Key",
          suggestedKey: "AI_BACKEND_CUSTOM_SECRET"
        };
      }
      if (context.value?.startsWith("custom-encrypted-blob")) {
        return {
          isSecret: true,
          description: "Encrypted blob credential",
          suggestedKey: "ENCRYPTED_VAULT_BLOB"
        };
      }
      return false;
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers, {
      customDetectors: [customDetector]
    });

    expect(redactedServers.aiBackend.env?.CUSTOM_SECRET).toBe("${CUSTOM_SECRET}");
    expect(redactedServers.aiBackend.args?.[1]).toBe("${ENCRYPTED_VAULT_BLOB}");

    const customSecretEnv = requiredEnv.find(e => e.key === "CUSTOM_SECRET");
    expect(customSecretEnv?.description).toBe("Custom AI Agent Secret Key");
    expect(customSecretEnv?.isSecret).toBe(true);

    const vaultBlobEnv = requiredEnv.find(e => e.key === "ENCRYPTED_VAULT_BLOB");
    expect(vaultBlobEnv?.description).toBe("Encrypted blob credential");
    expect(vaultBlobEnv?.isSecret).toBe(true);
  });

  it("supports environment variable based pattern extension (SMCP_EXTRA_SECRET_KEYS / VALUES)", () => {
    const origKeys = process.env.SMCP_EXTRA_SECRET_KEYS;
    const origValues = process.env.SMCP_EXTRA_SECRET_VALUES;
    const origExclude = process.env.SMCP_EXCLUDE_SECRET_KEYS;

    try {
      process.env.SMCP_EXTRA_SECRET_KEYS = "ENV_CONFIDENTIAL_*,MY_SPECIAL_HASH";
      process.env.SMCP_EXTRA_SECRET_VALUES = "/^env-secret-[0-9]+$/";
      process.env.SMCP_EXCLUDE_SECRET_KEYS = "ALLOWLISTED_KEY";

      expect(isSecretKey("ENV_CONFIDENTIAL_A")).toBe(true);
      expect(isSecretKey("MY_SPECIAL_HASH")).toBe(true);
      expect(isSecretValue("env-secret-456")).toBe(true);
      expect(isSecretKey("ALLOWLISTED_KEY")).toBe(false);
    } finally {
      if (origKeys !== undefined) process.env.SMCP_EXTRA_SECRET_KEYS = origKeys;
      else delete process.env.SMCP_EXTRA_SECRET_KEYS;

      if (origValues !== undefined) process.env.SMCP_EXTRA_SECRET_VALUES = origValues;
      else delete process.env.SMCP_EXTRA_SECRET_VALUES;

      if (origExclude !== undefined) process.env.SMCP_EXCLUDE_SECRET_KEYS = origExclude;
      else delete process.env.SMCP_EXCLUDE_SECRET_KEYS;
    }
  });

  it("redacts MCP servers using extraKeyPatterns, extraValuePatterns, and excludeKeyPatterns", () => {
    const servers: Record<string, McpServerConfig> = {
      customService: {
        command: "run-service",
        args: ["--token", "mycorp-val-12345"],
        env: {
          CORP_APP_SIGNATURE: "plain-signature",
          PUBLIC_KEY_CONF: "not-a-secret"
        }
      }
    };

    const { redactedServers, requiredEnv } = redactMcpServers(servers, {
      extraKeyPatterns: ["CORP_APP_SIGNATURE"],
      extraValuePatterns: ["/^mycorp-val-[0-9]+$/"],
      excludeKeyPatterns: ["PUBLIC_KEY_CONF"]
    });

    // CORP_APP_SIGNATURE is redacted
    expect(redactedServers.customService.env?.CORP_APP_SIGNATURE).toBe("${CORP_APP_SIGNATURE}");
    expect(requiredEnv.some(e => e.key === "CORP_APP_SIGNATURE" && e.isSecret)).toBe(true);

    // PUBLIC_KEY_CONF is excluded from redaction
    expect(redactedServers.customService.env?.PUBLIC_KEY_CONF).toBe("not-a-secret");
    expect(requiredEnv.some(e => e.key === "PUBLIC_KEY_CONF")).toBe(false);

    // mycorp-val-12345 is redacted in args
    expect(redactedServers.customService.args?.[1]).toBe("${CUSTOMSERVICE_API_KEY}");
    expect(requiredEnv.some(e => e.key === "CUSTOMSERVICE_API_KEY" && e.isSecret)).toBe(true);
  });

  describe("Command String & Array Redaction and Flag Parsing (SEC-01)", () => {
    it("redacts credentials and secret flags in command strings", () => {
      const servers: Record<string, McpServerConfig> = {
        context7: {
          command: "bunx -y @upstash/context7-mcp --api-key ctx7sk-a57aa5ff-d79b-4ada-8e3d-96755c5cc6a9"
        },
        postgres: {
          command: "npx @modelcontextprotocol/server-postgres postgresql://user:secret123@db.internal:5432/prod"
        },
        customApp: {
          command: "node server.js --token=mysecrettoken"
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);

      expect(redactedServers.context7.command).toContain("--api-key ${CONTEXT7_API_KEY}");
      expect(redactedServers.postgres.command).toBe("npx @modelcontextprotocol/server-postgres ${POSTGRES_DATABASE_URL}");
      expect(redactedServers.customApp.command).toBe("node server.js --token=${CUSTOMAPP_TOKEN}");

      expect(requiredEnv.some((e) => e.key === "CONTEXT7_API_KEY" && e.isSecret)).toBe(true);
      expect(requiredEnv.some((e) => e.key === "POSTGRES_DATABASE_URL" && e.isSecret)).toBe(true);
      expect(requiredEnv.some((e) => e.key === "CUSTOMAPP_TOKEN" && e.isSecret)).toBe(true);
    });

    it("redacts array command format (OpenCode schema)", () => {
      const servers: Record<string, McpServerConfig> = {
        openCodeServer: {
          command: [
            "bunx",
            "-y",
            "@upstash/context7-mcp",
            "--api-key",
            "ctx7sk-a57aa5ff-d79b-4ada-8e3d-96755c5cc6a9"
          ] as any
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      const cmd = (redactedServers.openCodeServer.command as unknown) as string[];
      expect(cmd[3]).toBe("--api-key");
      expect(cmd[4]).toBe("${OPENCODESERVER_API_KEY}");
      expect(requiredEnv.some((e) => e.key === "OPENCODESERVER_API_KEY" && e.isSecret)).toBe(true);
    });

    it("redacts --flag=value and paired flag arguments in args array", () => {
      const servers: Record<string, McpServerConfig> = {
        flagService: {
          command: "node",
          args: [
            "--api-key=sk-proj-123456789012345678901234567890",
            "--password",
            "arbitraryCustomSecret123",
            "--safe-flag=visible",
            "--unrelated",
            "safe-arg"
          ]
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      const args = redactedServers.flagService.args!;

      expect(args[0]).toBe("--api-key=${FLAGSERVICE_API_KEY}");
      expect(args[1]).toBe("--password");
      expect(args[2]).toBe("${FLAGSERVICE_API_KEY_2}");
      expect(args[3]).toBe("--safe-flag=visible");
      expect(args[4]).toBe("--unrelated");
      expect(args[5]).toBe("safe-arg");

      expect(requiredEnv.some((e) => e.key === "FLAGSERVICE_API_KEY" && e.isSecret)).toBe(true);
      expect(requiredEnv.some((e) => e.key === "FLAGSERVICE_API_KEY_2" && e.isSecret)).toBe(true);
    });
  });
});
