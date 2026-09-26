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
});
