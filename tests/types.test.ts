import { describe, expect, it } from "bun:test";
import {
  AgentProfileSchema,
  AuthConfigSchema,
  DetectedAgentSchema,
  ManifestSchema,
  McpServerConfigSchema,
  PluginEntrySchema,
  RequiredEnvSchema,
  ShareHistorySchema,
  ShareRecordSchema
} from "../packages/core/src/types/index.ts";

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

  it("validates a detected agent", () => {
    const detected = {
      id: "opencode",
      name: "OpenCode",
      mcpConfigPath: "/path/to/opencode.json",
      skillsDirPath: null
    };
    const parsed = DetectedAgentSchema.parse(detected);
    expect(parsed.id).toBe("opencode");
    expect(parsed.mcpConfigPath).toBe("/path/to/opencode.json");
    expect(parsed.skillsDirPath).toBeNull();
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

describe("McpServerConfigSchema", () => {
  it("preserves unknown ecosystem properties like headers, cwd, disabled, and transport", () => {
    const config = {
      command: "node",
      args: ["server.js"],
      headers: { Authorization: "Bearer xyz" },
      cwd: "/app",
      disabled: false,
      transport: "stdio",
      extraCustomField: 123
    };
    const parsed = McpServerConfigSchema.parse(config) as Record<string, unknown>;
    expect(parsed.command).toBe("node");
    expect(parsed.args).toEqual(["server.js"]);
    expect(parsed.headers).toEqual({ Authorization: "Bearer xyz" });
    expect(parsed.cwd).toBe("/app");
    expect(parsed.disabled).toBe(false);
    expect(parsed.transport).toBe("stdio");
    expect(parsed.extraCustomField).toBe(123);
  });

  it("preserves passthrough properties when embedded in ManifestSchema", () => {
    const manifest = {
      name: "server-pack",
      version: "0.1.0",
      mcpServers: {
        remoteServer: {
          url: "https://example.com/mcp",
          headers: { "X-API-Key": "secret" },
          transport: "sse"
        }
      }
    };
    const parsed = ManifestSchema.parse(manifest);
    const remoteServer = parsed.mcpServers?.remoteServer as Record<string, unknown>;
    expect(remoteServer.url).toBe("https://example.com/mcp");
    expect(remoteServer.headers).toEqual({ "X-API-Key": "secret" });
    expect(remoteServer.transport).toBe("sse");
  });
});

describe("ManifestSchema validation", () => {
  it("accepts valid semver versions and formats", () => {
    const validVersions = [
      "0.0.1",
      "1.0.0",
      "10.20.30",
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-0.3.7",
      "1.0.0-x.7.z.92",
      "1.0.0-beta+exp.sha.5114f85",
      "1.0.0+20130313144700"
    ];
    for (const version of validVersions) {
      const manifest = { name: "valid-pack", version };
      expect(() => ManifestSchema.parse(manifest)).not.toThrow();
    }
  });

  it("rejects invalid semver versions", () => {
    const invalidVersions = [
      "1",
      "1.0",
      "v1.0.0",
      "01.0.0",
      "1.01.0",
      "1.0.01",
      "1.0.0.0",
      "alpha",
      "",
      "1.0.0-",
      "1.0.0+",
      "1.0.0-beta..1"
    ];
    for (const version of invalidVersions) {
      const manifest = { name: "valid-pack", version };
      expect(() => ManifestSchema.parse(manifest)).toThrow();
    }
  });

  it("accepts valid pack slug names", () => {
    const validNames = ["pack", "pack-name", "pack_name", "Pack-123_test"];
    for (const name of validNames) {
      expect(() => ManifestSchema.parse({ name, version: "1.0.0" })).not.toThrow();
    }
  });

  it("rejects invalid pack names", () => {
    const invalidNames = [
      "../evil",
      "..",
      "/evil",
      "evil/pack",
      "   ",
      "name with spaces",
      "pack@1",
      "pack:name",
      "pack#name",
      ""
    ];
    for (const name of invalidNames) {
      expect(() => ManifestSchema.parse({ name, version: "1.0.0" })).toThrow();
    }
  });

  it("applies default values for mcpServers, skills, and requiredEnv", () => {
    const minimal = {
      name: "minimal-pack",
      version: "1.0.0"
    };
    const parsed = ManifestSchema.parse(minimal);
    expect(parsed.mcpServers).toEqual({});
    expect(parsed.skills).toEqual([]);
    expect(parsed.plugins).toEqual([]);
    expect(parsed.requiredEnv).toEqual([]);
  });

  it("validates manifest with string and object plugin entries", () => {
    const manifestWithPlugins = {
      name: "plugin-pack",
      version: "1.0.0",
      plugins: [
        "opencode-gemini-auth@latest",
        {
          name: "custom-plugin",
          targetAgent: "opencode",
          description: "Local custom plugin",
          path: "./plugin/custom.ts",
          files: { "custom.ts": "console.log('hi');" }
        }
      ]
    };

    const parsed = ManifestSchema.parse(manifestWithPlugins);
    expect(parsed.plugins).toHaveLength(2);
    expect(parsed.plugins?.[0]).toBe("opencode-gemini-auth@latest");
  });

  it("validates agent profile with plugins configuration", () => {
    const profile = {
      name: "OpenCode",
      mcpConfig: { paths: ["./opencode.jsonc"], key: "mcpServers" },
      skills: { paths: ["~/.agents/skills"] },
      plugins: {
        paths: ["./opencode.jsonc"],
        key: "plugin",
        format: "array" as const,
        dirPaths: ["./plugin"]
      }
    };
    const parsed = AgentProfileSchema.parse(profile);
    expect(parsed.plugins?.key).toBe("plugin");
    expect(parsed.plugins?.format).toBe("array");
    expect(parsed.plugins?.dirPaths).toEqual(["./plugin"]);
  });
});

describe("PluginEntrySchema", () => {
  it("validates string plugin entries", () => {
    expect(PluginEntrySchema.parse("opencode-gemini-auth@latest")).toBe("opencode-gemini-auth@latest");
    expect(PluginEntrySchema.parse("superpowers@claude-plugins-official")).toBe("superpowers@claude-plugins-official");
  });

  it("validates object plugin entries with optional properties", () => {
    const pluginObj = {
      name: "custom-tool",
      targetAgent: "opencode",
      description: "A custom tool plugin",
      path: "./plugin/custom-tool.ts",
      files: {
        "custom-tool.ts": "export default {};"
      }
    };
    const parsed = PluginEntrySchema.parse(pluginObj);
    expect(typeof parsed).toBe("object");
    if (typeof parsed === "object") {
      expect(parsed.name).toBe("custom-tool");
      expect(parsed.targetAgent).toBe("opencode");
      expect(parsed.files?.["custom-tool.ts"]).toBe("export default {};");
    }
  });

  it("rejects invalid plugin types and missing name", () => {
    expect(() => PluginEntrySchema.parse(123)).toThrow();
    expect(() => PluginEntrySchema.parse(null)).toThrow();
    expect(() => PluginEntrySchema.parse({})).toThrow();
    expect(() => PluginEntrySchema.parse({ description: "No name" })).toThrow();
    expect(() => PluginEntrySchema.parse({ name: 123 })).toThrow();
  });
});

describe("RequiredEnvSchema", () => {
  it("defaults isSecret to true when omitted", () => {
    const parsed = RequiredEnvSchema.parse({ key: "API_KEY" });
    expect(parsed.isSecret).toBe(true);
  });

  it("preserves explicit isSecret: false", () => {
    const parsed = RequiredEnvSchema.parse({ key: "PORT", isSecret: false });
    expect(parsed.isSecret).toBe(false);
  });
});

describe("ShareRecordSchema and ShareHistorySchema", () => {
  it("rejects invalid semver versions in ShareRecordSchema", () => {
    const invalidRecord = {
      name: "test-pack",
      version: "v1.0.0",
      targetType: "gist",
      targetUrl: "https://gist.github.com/abc",
      lastSharedAt: "2026-09-26T00:00:00.000Z",
      fingerprints: {}
    };
    expect(() => ShareRecordSchema.parse(invalidRecord)).toThrow();
  });

  it("accepts valid targetTypes and rejects invalid targetType", () => {
    const baseRecord = {
      name: "test-pack",
      version: "1.0.0",
      targetUrl: "https://example.com",
      lastSharedAt: "2026-09-26T00:00:00.000Z",
      fingerprints: {}
    };

    for (const targetType of ["gist", "repo", "local"] as const) {
      expect(() => ShareRecordSchema.parse({ ...baseRecord, targetType })).not.toThrow();
    }

    const invalidTargetTypes = ["s3", "github", "invalid", "", 123];
    for (const targetType of invalidTargetTypes) {
      expect(() => ShareRecordSchema.parse({ ...baseRecord, targetType })).toThrow();
    }
  });

  it("applies default values for fingerprints in ShareRecordSchema", () => {
    const parsed = ShareRecordSchema.parse({
      name: "test-pack",
      version: "1.0.0",
      targetType: "gist",
      targetUrl: "https://gist.github.com/abc",
      lastSharedAt: "2026-09-26T00:00:00.000Z",
      fingerprints: {}
    });
    expect(parsed.fingerprints.mcpServers).toEqual({});
    expect(parsed.fingerprints.skills).toEqual({});
  });

  it("applies default shares empty array in ShareHistorySchema", () => {
    const parsed = ShareHistorySchema.parse({});
    expect(parsed.shares).toEqual([]);
  });
});

describe("AuthConfigSchema", () => {
  it("validates empty auth config", () => {
    const parsed = AuthConfigSchema.parse({});
    expect(parsed.githubToken).toBeUndefined();
    expect(parsed.githubUser).toBeUndefined();
  });

  it("validates auth config with token and user", () => {
    const parsed = AuthConfigSchema.parse({
      githubToken: "ghp_1234567890abcdef",
      githubUser: "octocat"
    });
    expect(parsed.githubToken).toBe("ghp_1234567890abcdef");
    expect(parsed.githubUser).toBe("octocat");
  });

  it("rejects invalid types in auth config", () => {
    expect(() => AuthConfigSchema.parse({ githubToken: 123 })).toThrow();
    expect(() => AuthConfigSchema.parse({ githubUser: false })).toThrow();
  });
});
