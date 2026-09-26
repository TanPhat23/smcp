import { describe, expect, it } from "bun:test";
import { ManifestSchema, AgentProfileSchema, ShareHistorySchema } from "../src/types.ts";

describe("Types and Schemas", () => {
  it("validates a valid smcp.json manifest", () => {
    const validManifest = {
      name: "test-pack",
      version: "1.0.0",
      description: "A test agent pack",
      mcpServers: {
        postgres: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"]
        }
      },
      skills: [
        {
          name: "test-skill",
          path: "skills/test-skill/SKILL.md",
          description: "A test skill"
        }
      ],
      requiredEnv: [
        {
          key: "DATABASE_URL",
          description: "Database URL",
          isSecret: true
        }
      ]
    };

    const parsed = ManifestSchema.parse(validManifest);
    expect(parsed.name).toBe("test-pack");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.mcpServers?.postgres.command).toBe("npx");
  });

  it("validates an agent profile", () => {
    const profile = {
      name: "OpenCode",
      mcpConfig: {
        paths: ["~/.config/opencode/opencode.json"],
        key: "mcpServers"
      },
      skills: {
        paths: ["~/.config/opencode/skills"]
      }
    };
    const parsed = AgentProfileSchema.parse(profile);
    expect(parsed.name).toBe("OpenCode");
  });

  it("validates share history", () => {
    const history = {
      shares: [
        {
          name: "test-pack",
          version: "1.0.0",
          targetType: "gist",
          targetUrl: "https://gist.github.com/abc",
          gistId: "abc",
          lastSharedAt: "2026-09-26T00:00:00.000Z",
          fingerprints: {
            mcpServers: { postgres: "hash1" },
            skills: { "test-skill": "hash2" }
          }
        }
      ]
    };
    const parsed = ShareHistorySchema.parse(history);
    expect(parsed.shares.length).toBe(1);
    expect(parsed.shares[0].targetType).toBe("gist");
  });
});
