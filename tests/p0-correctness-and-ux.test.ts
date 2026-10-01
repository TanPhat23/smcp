import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AGENTS,
  resolveActiveAgentPath,
  type AgentProfile
} from "../packages/core/src/index.ts";

describe("P0 Correctness & UX Improvements", () => {
  let testDir: string;
  let homeDir: string;
  let binSmcp: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      "smcp-p0-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    homeDir = path.join(testDir, "userhome");
    fs.mkdirSync(homeDir, { recursive: true });
    binSmcp = path.resolve(__dirname, "../packages/cli/bin/smcp.js");
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("1. Config scope (global vs project)", () => {
    it("resolveActiveAgentPath supports scope='global' and prefers global config directory", () => {
      const paths = [
        "./opencode.jsonc",
        "./opencode.json",
        "~/.config/opencode/opencode.jsonc",
        "~/.config/opencode/opencode.json"
      ];

      // Default / global scope should resolve to global path
      const resolvedGlobal = resolveActiveAgentPath(paths, { scope: "global", homeDir });
      expect(resolvedGlobal).toBe(path.join(homeDir, ".config", "opencode", "opencode.jsonc"));

      // Project scope should resolve to project path in cwd
      const resolvedProject = resolveActiveAgentPath(paths, { scope: "project", homeDir, cwd: testDir });
      expect(resolvedProject).toBe(path.resolve(testDir, "opencode.jsonc"));
    });

    it("CLI install defaults to global scope and writes to ~/.config/opencode/opencode.jsonc", () => {
      const packDir = path.join(testDir, "sample-pack");
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "scope-test-pack",
          version: "1.0.0",
          mcpServers: {
            scopeServer: { command: ["npx", "-y", "sample-mcp"] }
          }
        }),
        "utf8"
      );

      const cwdDir = path.join(testDir, "project-cwd");
      fs.mkdirSync(cwdDir, { recursive: true });

      const output = execSync(
        `node "${binSmcp}" install "${packDir}" -a opencode -f -y --json`,
        {
          cwd: cwdDir,
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            SMCP_DIR: path.join(homeDir, ".smcp")
          }
        }
      );

      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.scope).toBe("global");

      // Verify it did NOT create opencode.jsonc in cwdDir
      expect(fs.existsSync(path.join(cwdDir, "opencode.jsonc"))).toBe(false);

      // Verify it DID write to homeDir/.config/opencode/opencode.jsonc
      const globalConfigPath = path.join(homeDir, ".config", "opencode", "opencode.jsonc");
      expect(fs.existsSync(globalConfigPath)).toBe(true);

      const written = JSON.parse(fs.readFileSync(globalConfigPath, "utf8"));
      expect(written.mcp.servers.scopeServer).toBeDefined();

      // Verify writtenPaths includes the exact written file
      expect(parsed.writtenPaths).toBeDefined();
      expect(parsed.writtenPaths.opencode.config).toBe(globalConfigPath);
      expect(parsed.writtenPaths.opencode.scope).toBe("global");
    });

    it("CLI install with --project writes to ./opencode.jsonc in current project", () => {
      const packDir = path.join(testDir, "sample-pack");
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "project-scope-pack",
          version: "1.0.0",
          mcpServers: {
            projServer: { command: ["npx", "-y", "proj-mcp"] }
          }
        }),
        "utf8"
      );

      const projectDir = path.join(testDir, "my-project");
      fs.mkdirSync(projectDir, { recursive: true });

      const output = execSync(
        `node "${binSmcp}" install "${packDir}" -a opencode -f -y --project --json`,
        {
          cwd: projectDir,
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            SMCP_DIR: path.join(homeDir, ".smcp")
          }
        }
      );

      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.scope).toBe("project");

      // Verify it DID write to projectDir/opencode.jsonc
      const projectConfigPath = path.join(projectDir, "opencode.jsonc");
      expect(fs.existsSync(projectConfigPath)).toBe(true);

      const written = JSON.parse(fs.readFileSync(projectConfigPath, "utf8"));
      expect(written.mcp.servers.projServer).toBeDefined();
    });
  });

  describe("2. Non-TTY fail-fast on required environment variables", () => {
    it("fails fast with clear error message when non-TTY and missing required env (without hanging)", () => {
      const packDir = path.join(testDir, "secret-pack");
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "secret-pack",
          version: "1.0.0",
          requiredEnv: [
            { key: "API_KEY", isSecret: true, description: "Secret API token" }
          ],
          mcpServers: {
            secretServer: { command: ["npx", "-y", "pkg", "--key", "${API_KEY}"] }
          }
        }),
        "utf8"
      );

      try {
        // Run without -y, without --json, without -e in piped non-TTY mode
        execSync(`node "${binSmcp}" install "${packDir}" -a opencode -f`, {
          cwd: testDir,
          encoding: "utf8",
          stdio: "pipe",
          timeout: 5000, // 5s timeout to catch any hang
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            SMCP_DIR: path.join(homeDir, ".smcp")
          }
        });
        expect(false).toBe(true); // Should not succeed
      } catch (err: any) {
        const stderr = (err.stderr || err.stdout || "").toString();
        expect(stderr).toContain("non-TTY");
        expect(stderr).toContain("API_KEY");
      }
    });
  });

  describe("3. Empty secret warning", () => {
    it("warns when a secret is provided as empty string", () => {
      const packDir = path.join(testDir, "empty-secret-pack");
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "empty-secret-pack",
          version: "1.0.0",
          requiredEnv: [
            { key: "CONTEXT7_API_KEY", isSecret: true }
          ],
          mcpServers: {
            ctx7: { command: ["npx", "-y", "ctx7", "--key", "${CONTEXT7_API_KEY}"] }
          }
        }),
        "utf8"
      );

      const output = execSync(
        `node "${binSmcp}" install "${packDir}" -a opencode -f -y --json -e CONTEXT7_API_KEY=`,
        {
          cwd: testDir,
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            SMCP_DIR: path.join(homeDir, ".smcp")
          }
        }
      );

      const parsed = JSON.parse(output);
      expect(parsed.warnings).toBeDefined();
      expect(parsed.warnings.some((w: string) => w.includes("CONTEXT7_API_KEY") && w.includes("empty"))).toBe(true);
    });
  });

  describe("4. Native Env Placeholders (--native-env)", () => {
    it("emits {env:KEY} for OpenCode when --native-env is set", () => {
      const packDir = path.join(testDir, "native-env-pack");
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(
        path.join(packDir, "smcp.json"),
        JSON.stringify({
          name: "native-env-pack",
          version: "1.0.0",
          requiredEnv: [
            { key: "DB_KEY", isSecret: true }
          ],
          mcpServers: {
            db: { command: ["npx", "-y", "db-mcp", "--key", "${DB_KEY}"] }
          }
        }),
        "utf8"
      );

      const output = execSync(
        `node "${binSmcp}" install "${packDir}" -a opencode -f -y --native-env --json -e DB_KEY=secret_literal`,
        {
          cwd: testDir,
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            SMCP_DIR: path.join(homeDir, ".smcp")
          }
        }
      );

      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);

      const globalConfigPath = path.join(homeDir, ".config", "opencode", "opencode.jsonc");
      const config = JSON.parse(fs.readFileSync(globalConfigPath, "utf8"));
      // The command should contain '{env:DB_KEY}' instead of the baked 'secret_literal'
      expect(config.mcp.servers.db.command).toContain("{env:DB_KEY}");
      expect(config.mcp.servers.db.command).not.toContain("secret_literal");
    });
  });
});
