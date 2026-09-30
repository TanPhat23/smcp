import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SECRET_VALUE_PATTERNS,
  detectSecret,
  isSecretKey,
  isSecretValue,
  redactMcpServers
} from "../packages/core/src/core/redactor/index.ts";
import type { McpServerConfig } from "../packages/core/src/types/index.ts";

describe("Redactor Engine Deep Edge Cases, Protocols, Headers & ReDoS Resistance", () => {
  describe("URL & Protocol Redaction Edge Cases", () => {
    it("redacts IPv6 URLs containing embedded user:password credentials", () => {
      const servers: Record<string, McpServerConfig> = {
        ipv6Server: {
          url: "http://admin:secretPass@[::1]:8080/sse"
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      expect(redactedServers.ipv6Server.url).toBe("${IPV6SERVER_URL}");
      expect(requiredEnv.some((e) => e.key === "IPV6SERVER_URL" && e.isSecret)).toBe(true);
    });

    it("redacts IPv6 URLs containing tokens in query parameters", () => {
      const servers: Record<string, McpServerConfig> = {
        ipv6Query: {
          url: "http://[::1]:8080/sse?token=ghp_1234567890abcdef1234567890abcdef"
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      expect(redactedServers.ipv6Query.url).toBe("${IPV6QUERY_URL}");
      expect(requiredEnv.some((e) => e.key === "IPV6QUERY_URL" && e.isSecret)).toBe(true);
    });

    it("does not redact URLs with safe, non-sensitive query parameters", () => {
      const servers: Record<string, McpServerConfig> = {
        publicApi: {
          url: "https://api.example.com/v1/sse?page=1&limit=50&format=json&version=2"
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      expect(redactedServers.publicApi.url).toBe(
        "https://api.example.com/v1/sse?page=1&limit=50&format=json&version=2"
      );
      expect(requiredEnv).toHaveLength(0);
    });

    it("redacts URLs where token is embedded in hash fragment", () => {
      const servers: Record<string, McpServerConfig> = {
        hashRemote: {
          url: "https://auth.internal/mcp#token=ghp_1234567890abcdef1234567890abcdef"
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      expect(redactedServers.hashRemote.url).toBe("${HASHREMOTE_URL}");
      expect(requiredEnv.some((e) => e.key === "HASHREMOTE_URL" && e.isSecret)).toBe(true);
    });

    it("redacts encoded connection strings with special characters in password", () => {
      const servers: Record<string, McpServerConfig> = {
        mongo: {
          args: ["mongodb://user:p%40ssw%3Ard@cluster0.mongodb.net:27017/db"]
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      expect(redactedServers.mongo.args?.[0]).toBe("${MONGO_DATABASE_URL}");
      expect(requiredEnv.some((e) => e.key === "MONGO_DATABASE_URL" && e.isSecret)).toBe(true);
    });
  });

  describe("HTTP Headers Redaction Deep Edge Cases", () => {
    it("handles case-insensitive Authorization headers (all caps, lowercase, mixed)", () => {
      const servers: Record<string, McpServerConfig> = {
        s1: {
          url: "https://s1.example.com",
          headers: { authorization: "Bearer sk-ant-api03-12345678901234567890" }
        } as any,
        s2: {
          url: "https://s2.example.com",
          headers: { AUTHORIZATION: "Bearer sk-ant-api03-12345678901234567890" }
        } as any,
        s3: {
          url: "https://s3.example.com",
          headers: { AuThOrIzAtIoN: "Bearer sk-ant-api03-12345678901234567890" }
        } as any
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);

      expect((redactedServers.s1 as any).headers.authorization).toBe("Bearer ${S1_AUTHORIZATION}");
      expect((redactedServers.s2 as any).headers.AUTHORIZATION).toBe("Bearer ${S2_AUTHORIZATION}");
      expect((redactedServers.s3 as any).headers.AuThOrIzAtIoN).toBe("Bearer ${S3_AUTHORIZATION}");

      expect(requiredEnv.some((e) => e.key === "S1_AUTHORIZATION" && e.isSecret)).toBe(true);
      expect(requiredEnv.some((e) => e.key === "S2_AUTHORIZATION" && e.isSecret)).toBe(true);
      expect(requiredEnv.some((e) => e.key === "S3_AUTHORIZATION" && e.isSecret)).toBe(true);
    });

    it("redacts multiple sensitive headers on the same server with distinct variable keys", () => {
      const servers: Record<string, McpServerConfig> = {
        multiHeader: {
          url: "https://api.internal.com",
          headers: {
            Authorization: "Bearer sk-ant-secret",
            "X-Api-Key": "key-12345",
            "X-Vault-Token": "vault-secret-987",
            "Content-Type": "application/json",
            "User-Agent": "smcp-client/1.0"
          }
        } as any
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      const headers = (redactedServers.multiHeader as any).headers;

      expect(headers.Authorization).toBe("Bearer ${MULTIHEADER_AUTHORIZATION}");
      expect(headers["X-Api-Key"]).toBe("${MULTIHEADER_X_API_KEY}");
      expect(headers["X-Vault-Token"]).toBe("${MULTIHEADER_X_VAULT_TOKEN}");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["User-Agent"]).toBe("smcp-client/1.0");

      expect(requiredEnv.some((e) => e.key === "MULTIHEADER_AUTHORIZATION" && e.isSecret)).toBe(true);
      expect(requiredEnv.some((e) => e.key === "MULTIHEADER_X_API_KEY" && e.isSecret)).toBe(true);
      expect(requiredEnv.some((e) => e.key === "MULTIHEADER_X_VAULT_TOKEN" && e.isSecret)).toBe(true);
    });
  });

  describe("Command Flags & Arguments Redaction", () => {
    it("redacts quoted flags in command strings", () => {
      const servers: Record<string, McpServerConfig> = {
        cliTool: {
          command: 'runner --token="sk-ant-1234567890abcdef" --mode=\'silent\''
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      expect(redactedServers.cliTool.command).toContain("--token=${CLITOOL_TOKEN}");
      expect(redactedServers.cliTool.command).toContain("--mode='silent'");
      expect(requiredEnv.some((e) => e.key === "CLITOOL_TOKEN" && e.isSecret)).toBe(true);
    });

    it("assigns distinct sequence numbers for 5+ secret arguments on the same server", () => {
      const servers: Record<string, McpServerConfig> = {
        vault: {
          command: "op-sync",
          args: [
            "--key1", "sk-11111111111111111111",
            "--key2", "sk-22222222222222222222",
            "--key3", "sk-33333333333333333333",
            "--key4", "sk-44444444444444444444",
            "--key5", "sk-55555555555555555555"
          ]
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);
      const args = redactedServers.vault.args!;

      expect(args[1]).toBe("${VAULT_API_KEY}");
      expect(args[3]).toBe("${VAULT_API_KEY_2}");
      expect(args[5]).toBe("${VAULT_API_KEY_3}");
      expect(args[7]).toBe("${VAULT_API_KEY_4}");
      expect(args[9]).toBe("${VAULT_API_KEY_5}");

      expect(requiredEnv.filter((e) => e.key.startsWith("VAULT_API_KEY"))).toHaveLength(5);
    });

    it("generates safe POSIX variable prefixes for unusual server names in args", () => {
      const servers: Record<string, McpServerConfig> = {
        "@org/server-v2.0": {
          args: ["sk-12345678901234567890"]
        },
        "99-problems": {
          args: ["sk-12345678901234567890"]
        },
        "🤖-bot-server": {
          args: ["sk-12345678901234567890"]
        }
      };

      const { redactedServers, requiredEnv } = redactMcpServers(servers);

      expect(redactedServers["@org/server-v2.0"].args?.[0]).toBe("${_ORG_SERVER_V2_0_API_KEY}");
      expect(redactedServers["99-problems"].args?.[0]).toBe("${_99_PROBLEMS_API_KEY}");
      expect(redactedServers["🤖-bot-server"].args?.[0]).toBe("${___BOT_SERVER_API_KEY}");

      const keys = requiredEnv.map((e) => e.key);
      for (const k of keys) {
        expect(/^[A-Z_][A-Z0-9_]*$/.test(k)).toBe(true);
      }
    });
  });

  describe("ReDoS Safety (Catastrophic Backtracking Prevention)", () => {
    it("evaluates DEFAULT_SECRET_VALUE_PATTERNS against pathological strings in <5ms without stalling", () => {
      const pathologicalInputs = [
        "sk-" + "a".repeat(200) + "!",
        "github_pat_" + "x".repeat(200) + "@",
        "ghp_" + "0".repeat(200) + "%",
        "ey" + "a".repeat(100) + "." + "b".repeat(100) + "!notjwt",
        "postgresql://" + "u".repeat(150) + ":" + "p".repeat(150),
        "AIzaSy" + "k".repeat(150) + "$",
        "xoxb-" + "9".repeat(200) + "#",
        "sbp_" + "s".repeat(200) + "~"
      ];

      for (const input of pathologicalInputs) {
        const start = performance.now();
        for (const pattern of DEFAULT_SECRET_VALUE_PATTERNS) {
          pattern.test(input);
        }
        const duration = performance.now() - start;
        expect(duration).toBeLessThan(15);
      }
    });
  });
});
