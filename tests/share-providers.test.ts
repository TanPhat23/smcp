import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getAllShareProviders,
  getShareProvider,
  registerShareProvider,
  resetShareProviders,
  shareCommand,
  unregisterShareProvider,
  type ShareProvider,
  type ShareProviderContext
} from "../packages/cli/src/commands/share/index.ts";
import { saveCustomAgent } from "../packages/core/src/core/agents/index.ts";

describe("ShareProvider Registry & Extensibility", () => {
  let testDir: string;
  let originalSmcpDir: string | undefined;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-provider-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(testDir, { recursive: true });

    originalSmcpDir = process.env.SMCP_DIR;
    process.env.SMCP_DIR = testDir;
  });

  afterEach(() => {
    resetShareProviders();

    if (originalSmcpDir !== undefined) {
      process.env.SMCP_DIR = originalSmcpDir;
    } else {
      delete process.env.SMCP_DIR;
    }
    delete process.env.SMCP_CUSTOM_AGENTS_PATH;

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("lists default built-in share providers (gist, repo, local)", () => {
    const providers = getAllShareProviders();
    const ids = providers.map((p) => p.id);
    expect(ids).toContain("gist");
    expect(ids).toContain("repo");
    expect(ids).toContain("local");
  });

  it("registers and resolves a custom share provider", () => {
    const customProvider: ShareProvider = {
      id: "s3-bucket",
      label: "Amazon S3 Bucket",
      hint: "Uploads pack to an S3 bucket",
      publish: async () => true
    };

    registerShareProvider(customProvider);

    const found = getShareProvider("s3-bucket");
    expect(found).not.toBeNull();
    expect(found?.label).toBe("Amazon S3 Bucket");
    expect(getAllShareProviders().some((p) => p.id === "s3-bucket")).toBe(true);
  });

  it("validates provider schema and rejects prototype pollution names", () => {
    expect(() => registerShareProvider(null as any)).toThrow(/Invalid ShareProvider/);

    expect(() =>
      registerShareProvider({
        id: "__proto__",
        label: "Malicious",
        publish: async () => {}
      } as any)
    ).toThrow(/prototype pollution key '__proto__'/);

    expect(() =>
      registerShareProvider({
        id: "invalid/id",
        label: "Invalid ID",
        publish: async () => {}
      } as any)
    ).toThrow(/Invalid provider id/);

    expect(() =>
      registerShareProvider({
        id: "no-label",
        label: "",
        publish: async () => {}
      } as any)
    ).toThrow(/must implement a non-empty 'label'/);
  });

  it("unregisters provider by id and restores defaults via resetShareProviders", () => {
    const customProvider: ShareProvider = {
      id: "temporary-provider",
      label: "Temp",
      publish: async () => {}
    };

    registerShareProvider(customProvider);
    expect(getShareProvider("temporary-provider")).not.toBeNull();

    const unregistered = unregisterShareProvider("temporary-provider");
    expect(unregistered).toBe(true);
    expect(getShareProvider("temporary-provider")).toBeNull();

    registerShareProvider(customProvider);
    resetShareProviders();
    expect(getShareProvider("temporary-provider")).toBeNull();
  });

  it("executes custom share provider via shareCommand -P <custom-provider>", async () => {
    // Setup a mock agent with a server
    const agentMcpPath = path.join(testDir, "agent-mcp.json");
    fs.writeFileSync(
      agentMcpPath,
      JSON.stringify({
        mcpServers: {
          myCustomServer: { command: "node", args: ["server.js"] }
        }
      }),
      "utf8"
    );
    const customProfilesPath = path.join(testDir, "custom-agents.json");
    process.env.SMCP_CUSTOM_AGENTS_PATH = customProfilesPath;
    saveCustomAgent("test-agent", {
      name: "Test Agent",
      mcpConfig: { paths: [agentMcpPath], key: "mcpServers" },
      skills: null
    });

    let publishedContext: ShareProviderContext | null = null;

    const mockArchiveProvider: ShareProvider = {
      id: "archive",
      label: "Archive Zip",
      hint: "Export to zip file",
      publish: async (ctx) => {
        publishedContext = ctx;
        return true;
      }
    };

    registerShareProvider(mockArchiveProvider);

    await shareCommand({
      provider: "archive",
      name: "archive-test-pack",
      servers: ["myCustomServer"],
      skills: [],
      plugins: [],
      yes: true,
      json: true
    });

    expect(publishedContext).not.toBeNull();
    const ctx = publishedContext as unknown as ShareProviderContext;
    expect(ctx.cleanPackName).toBe("archive-test-pack");
    expect(ctx.manifest.name).toBe("archive-test-pack");
    expect(ctx.manifest.mcpServers?.myCustomServer).toBeDefined();
  });
});
