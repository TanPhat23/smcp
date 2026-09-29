import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatServerForAgent,
  getAllMcpAdapters,
  getMcpAdapter,
  mergeMcpServersIntoFile,
  OpenCodeMcpAdapter,
  registerMcpAdapter,
  resetMcpAdapters,
  StandardMcpAdapter,
  unregisterMcpAdapter
} from "../packages/core/src/core/merger/index.ts";
import type { McpAdapter, McpServerConfig } from "../packages/core/src/types/index.ts";

describe("Hardened MCP Adapters Subsystem", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-adapters-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });
    resetMcpAdapters();
  });

  afterEach(() => {
    resetMcpAdapters();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Registry Security & Validation", () => {
    it("rejects non-object, null, and array adapter candidates", () => {
      expect(() => registerMcpAdapter(null as any)).toThrow(/Invalid MCP adapter/);
      expect(() => registerMcpAdapter(undefined as any)).toThrow(/Invalid MCP adapter/);
      expect(() => registerMcpAdapter([] as any)).toThrow(/Invalid MCP adapter/);
      expect(() => registerMcpAdapter("string" as any)).toThrow(/Invalid MCP adapter/);
      expect(() => registerMcpAdapter(123 as any)).toThrow(/Invalid MCP adapter/);
    });

    it("rejects invalid, empty, or oversized adapter names", () => {
      const validMethods = {
        matches: () => true,
        serialize: () => ({}),
        deserialize: () => ({})
      };

      expect(() => registerMcpAdapter({ name: "", ...validMethods })).toThrow(/Invalid adapter name/);
      expect(() => registerMcpAdapter({ name: "   ", ...validMethods })).toThrow(/Invalid adapter name/);
      expect(() => registerMcpAdapter({ name: "has spaces", ...validMethods })).toThrow(/Invalid adapter name/);
      expect(() => registerMcpAdapter({ name: "invalid!@#$", ...validMethods })).toThrow(/Invalid adapter name/);
      expect(() => registerMcpAdapter({ name: "a".repeat(65), ...validMethods })).toThrow(/Invalid adapter name/);
    });

    it("rejects prototype pollution keys as adapter names", () => {
      const validMethods = {
        matches: () => true,
        serialize: () => ({}),
        deserialize: () => ({})
      };

      expect(() => registerMcpAdapter({ name: "__proto__", ...validMethods })).toThrow(/prototype pollution/);
      expect(() => registerMcpAdapter({ name: "constructor", ...validMethods })).toThrow(/prototype pollution/);
      expect(() => registerMcpAdapter({ name: "prototype", ...validMethods })).toThrow(/prototype pollution/);
    });

    it("requires complete implementation of matches, serialize, and deserialize functions", () => {
      expect(() => registerMcpAdapter({ name: "test-missing-matches" } as any)).toThrow(/matches/);
      expect(() =>
        registerMcpAdapter({
          name: "test-missing-serialize",
          matches: () => true
        } as any)
      ).toThrow(/serialize/);
      expect(() =>
        registerMcpAdapter({
          name: "test-missing-deserialize",
          matches: () => true,
          serialize: () => ({})
        } as any)
      ).toThrow(/deserialize/);
    });

    it("freezes registered adapter and provides read-only defensive snapshot in getAllMcpAdapters", () => {
      const adapter: McpAdapter = {
        name: "freeze-test",
        matches: () => false,
        serialize: () => ({}),
        deserialize: () => ({})
      };

      registerMcpAdapter(adapter);
      const retrieved = getMcpAdapter("freeze-test");
      expect(Object.isFrozen(retrieved)).toBe(true);

      const all = getAllMcpAdapters();
      expect(Object.isFrozen(all)).toBe(true);
    });

    it("handles unregisterMcpAdapter safely against nonexistent names and prototype pollution", () => {
      expect(unregisterMcpAdapter("nonexistent-adapter")).toBe(false);
      expect(unregisterMcpAdapter("__proto__")).toBe(false);
      expect(unregisterMcpAdapter("constructor")).toBe(false);
      expect(unregisterMcpAdapter("")).toBe(false);
      expect(unregisterMcpAdapter(null as any)).toBe(false);
    });
  });

  describe("Resilience to Faulty & Crashing Adapters", () => {
    it("safely handles custom adapter whose matches() throws an exception", () => {
      const faultyAdapter: McpAdapter = {
        name: "buggy-matcher",
        matches: () => {
          throw new Error("Kaboom inside matches!");
        },
        serialize: () => ({}),
        deserialize: () => ({})
      };

      registerMcpAdapter(faultyAdapter);

      // Should not throw, but safely skip buggy-matcher and resolve fallback
      const resolved = getMcpAdapter({ format: "any-format" });
      expect(resolved.name).toBe("standard");
    });

    it("safely falls back to StandardMcpAdapter when serialize() throws an exception", () => {
      const faultyAdapter: McpAdapter = {
        name: "buggy-serializer",
        matches: (ctx) => ctx.format === "buggy",
        serialize: () => {
          throw new Error("Kaboom inside serialize!");
        },
        deserialize: () => ({})
      };

      registerMcpAdapter(faultyAdapter);

      const serverConfig: McpServerConfig = {
        command: "node",
        args: ["script.js"],
        env: { FOO: "bar" }
      };

      // formatServerForAgent should catch error and fall back without throwing
      const formatted = formatServerForAgent(
        serverConfig,
        "mcpServers",
        "/path/to/claude.json",
        undefined,
        "buggy"
      );

      expect(formatted.command).toBe("node");
      expect(formatted.args).toEqual(["script.js"]);
      expect(formatted.env).toEqual({ FOO: "bar" });
    });

    it("handles toxic context inputs (null, undefined, prototype keys) gracefully", () => {
      expect(getMcpAdapter(null as any).name).toBe("standard");
      expect(getMcpAdapter(undefined as any).name).toBe("standard");
      expect(getMcpAdapter("__proto__").name).toBe("standard");
      expect(getMcpAdapter("constructor").name).toBe("standard");
      expect(getMcpAdapter({ format: "__proto__" }).name).toBe("standard");
      expect(getMcpAdapter({ format: "constructor" }).name).toBe("standard");
    });
  });

  describe("OpenCodeMcpAdapter Hardening", () => {
    const adapter = new OpenCodeMcpAdapter();

    it("matches handles nullish and edge-case contexts safely", () => {
      expect(adapter.matches(undefined)).toBe(false);
      expect(adapter.matches(null as any)).toBe(false);
      expect(adapter.matches({ format: "opencode" })).toBe(true);
      expect(adapter.matches({ targetKey: "mcp" })).toBe(true);
      expect(adapter.matches({ agentId: "opencode" })).toBe(true);
      expect(adapter.matches({ agentId: "opencode", targetKey: "mcpServers" })).toBe(false);
      expect(adapter.matches({ targetKey: "mcpServers" })).toBe(false);
    });

    it("serialize handles null, undefined, or array serverConfig without throwing", () => {
      expect(adapter.serialize(null as any, {})).toEqual({});
      expect(adapter.serialize(undefined as any, {})).toEqual({});
      expect(adapter.serialize([] as any, {})).toEqual({});
    });

    it("strips prototype pollution keys from baseExisting, env, and headers", () => {
      const pollutedExisting = {
        type: "local",
        command: ["bunx", "tool"],
        enabled: true
      };
      Object.defineProperty(pollutedExisting, "__proto__", {
        value: { evil: true },
        enumerable: true,
        configurable: true
      });
      (pollutedExisting as any).constructor = { evil: true };

      const serverConfig: McpServerConfig = {
        command: "bunx",
        args: ["safe-arg"],
        env: {
          SAFE: "val",
          __proto__: "evil-env",
          constructor: "evil-constructor"
        } as any
      };

      const result = adapter.serialize(serverConfig, { targetKey: "mcp" }, pollutedExisting);
      expect(result.type).toBe("local");
      expect(result.command).toEqual(["bunx", "safe-arg"]);
      expect(result.enabled).toBe(true);
      expect(result.environment).toEqual({ SAFE: "val" });

      expect(Object.hasOwn(result, "__proto__")).toBe(false);
      expect(Object.hasOwn(result, "constructor")).toBe(false);
      expect(Object.hasOwn(result, "prototype")).toBe(false);
      expect(Object.hasOwn(result.environment as object, "__proto__")).toBe(false);
    });

    it("handles remote server format and validates headers cleanly", () => {
      const remoteConfig: McpServerConfig = {
        url: "https://remote.mcp.app",
        headers: {
          Authorization: "Bearer token123",
          __proto__: "evil-header"
        } as any
      };

      const result = adapter.serialize(remoteConfig, { targetKey: "mcp" });
      expect(result.type).toBe("remote");
      expect(result.url).toBe("https://remote.mcp.app");
      expect(result.enabled).toBe(true);
      expect(result.headers).toEqual({ Authorization: "Bearer token123" });
      expect(result.command).toBeUndefined();
      expect(result.args).toBeUndefined();
    });

    it("deserialize sanitizes array commands and environments cleanly", () => {
      const raw = {
        type: "local",
        command: ["bunx", "-y", "@modelcontextprotocol/test"],
        environment: { DB_URL: "postgres://..." }
      };

      const canon = adapter.deserialize(raw);
      expect(canon.command).toBe("bunx");
      expect(canon.args).toEqual(["-y", "@modelcontextprotocol/test"]);
      expect(canon.env).toEqual({ DB_URL: "postgres://..." });

      // Edge case: null or non-object raw
      expect(adapter.deserialize(null as any)).toEqual({});
      expect(adapter.deserialize([] as any)).toEqual({});
    });
  });

  describe("StandardMcpAdapter Hardening", () => {
    const adapter = new StandardMcpAdapter();

    it("handles null, undefined, or array configs safely", () => {
      expect(adapter.serialize(null as any, {})).toEqual({});
      expect(adapter.serialize(undefined as any, {})).toEqual({});
      expect(adapter.deserialize(null as any)).toEqual({});
    });

    it("normalizes OpenCode array command and environment into standard fields", () => {
      const raw = {
        command: ["python", "-m", "myservice"],
        environment: { API_KEY: "secret" }
      };

      const serialized = adapter.serialize(raw as any, {});
      expect(serialized.command).toBe("python");
      expect(serialized.args).toEqual(["-m", "myservice"]);
      expect(serialized.env).toEqual({ API_KEY: "secret" });
      expect(serialized.environment).toBeUndefined();
    });

    it("strips prototype pollution keys from standard serialized output", () => {
      const polluted: McpServerConfig = {
        command: "node",
        args: ["index.js"],
        env: {
          KEY: "VAL",
          __proto__: "evil"
        } as any
      };

      const out = adapter.serialize(polluted, {});
      expect(out.env).toEqual({ KEY: "VAL" });
      expect(Object.hasOwn(out, "__proto__")).toBe(false);
      expect(Object.hasOwn(out.env as object, "__proto__")).toBe(false);
    });
  });

  describe("End-to-End Merger Integration with Hardened Options", () => {
    it("rejects prototype pollution in mergeMcpServersIntoFile options", () => {
      const configPath = path.join(testDir, "sec-test.json");
      fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }), "utf8");

      expect(() =>
        mergeMcpServersIntoFile(configPath, {}, { mcpKey: "__proto__" })
      ).toThrow(/Invalid mcpKey/);

      expect(() =>
        mergeMcpServersIntoFile(configPath, {}, { format: "__proto__" })
      ).toThrow(/Invalid format/);

      expect(() =>
        mergeMcpServersIntoFile(configPath, {}, { agentId: "constructor" })
      ).toThrow(/Invalid agentId/);
    });

    it("falls back cleanly to standard adapter if an active custom adapter crashes during file merge", () => {
      const crasherAdapter: McpAdapter = {
        name: "crash-test",
        matches: (ctx) => ctx.format === "crash-format",
        serialize: () => {
          throw new Error("Crash during merge!");
        },
        deserialize: () => ({})
      };

      registerMcpAdapter(crasherAdapter);

      const configPath = path.join(testDir, "crash-fallback.json");
      fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }), "utf8");

      expect(() =>
        mergeMcpServersIntoFile(
          configPath,
          {
            resilientServer: { command: "node", args: ["worker.js"] }
          },
          {
            mcpKey: "mcpServers",
            format: "crash-format"
          }
        )
      ).not.toThrow();

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(parsed.mcpServers.resilientServer).toEqual({
        command: "node",
        args: ["worker.js"]
      });
    });
  });
});
