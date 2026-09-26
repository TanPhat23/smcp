import { describe, expect, it } from "bun:test";
import { isSecretKey, isSecretValue, redactMcpServers } from "../src/core/redactor.ts";
import type { McpServerConfig } from "../src/types.ts";

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
});
