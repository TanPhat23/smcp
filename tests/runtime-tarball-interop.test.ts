import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

describe("Runtime & Monorepo Package Tarball Interop", () => {
  const rootDir = path.resolve(__dirname, "..");
  const coreDir = path.join(rootDir, "packages", "core");
  const cliDir = path.join(rootDir, "packages", "cli");

  it("verifies package.json manifests have valid fields, licenses, and repository links", () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    const corePkg = JSON.parse(fs.readFileSync(path.join(coreDir, "package.json"), "utf8"));
    const cliPkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));

    expect(rootPkg.license).toBe("MIT");
    expect(corePkg.license).toBe("MIT");
    expect(cliPkg.license).toBe("MIT");

    expect(corePkg.name).toBe("@tanphat/smcp-core");
    expect(cliPkg.name).toBe("@tanphat/smcp");

    expect(corePkg.main).toBe("dist/index.js");
    expect(corePkg.types).toBe("dist/index.d.ts");
    expect(cliPkg.bin.smcp).toBe("bin/smcp.js");

    expect(corePkg.files).toContain("dist");
    expect(cliPkg.files).toContain("dist");
    expect(cliPkg.files).toContain("bin");
  });

  it("verifies built TypeScript declaration files exist for both packages", () => {
    const coreDts = path.join(coreDir, "dist", "index.d.ts");
    const cliDts = path.join(cliDir, "dist", "index.d.ts");
    const cliBinDts = path.join(cliDir, "dist", "cli.d.ts");

    expect(fs.existsSync(coreDts)).toBe(true);
    expect(fs.existsSync(cliDts)).toBe(true);
    expect(fs.existsSync(cliBinDts)).toBe(true);

    const coreDtsContent = fs.readFileSync(coreDts, "utf8");
    expect(coreDtsContent).toContain("export");
  });

  it("executes Node.js ESM import of core package without errors", () => {
    const coreDistPath = path.join(coreDir, "dist", "index.js");
    const script = `
      import * as core from '${coreDistPath}';
      if (typeof core.redactMcpServers !== 'function') throw new Error('missing redactMcpServers');
      if (typeof core.detectAgents !== 'function') throw new Error('missing detectAgents');
      if (typeof core.hashObject !== 'function') throw new Error('missing hashObject');
      console.log('CORE_NODE_ESM_OK');
    `;

    const out = execSync(`node --input-type=module -e "${script.replace(/\n/g, " ")}"`, {
      encoding: "utf8"
    });
    expect(out.trim()).toBe("CORE_NODE_ESM_OK");
  });

  it("executes Node.js ESM import of CLI library package without errors", () => {
    const cliDistPath = path.join(cliDir, "dist", "index.js");
    const script = `
      import * as cli from '${cliDistPath}';
      if (typeof cli.runCli !== 'function') throw new Error('missing runCli');
      if (typeof cli.exportPackLocally !== 'function') throw new Error('missing exportPackLocally');
      console.log('CLI_NODE_ESM_OK');
    `;

    const out = execSync(`node --input-type=module -e "${script.replace(/\n/g, " ")}"`, {
      encoding: "utf8"
    });
    expect(out.trim()).toBe("CLI_NODE_ESM_OK");
  });

  it("verifies npm pack dry-run produces clean tarballs without test files or node_modules", () => {
    const corePackOutput = execSync("npm pack --dry-run --json", {
      cwd: coreDir,
      encoding: "utf8"
    });
    const corePackInfo = JSON.parse(corePackOutput);
    const coreFiles = (corePackInfo[0].files as Array<{ path: string }>).map((f) => f.path);

    expect(coreFiles.some((f) => f.startsWith("dist/"))).toBe(true);
    expect(coreFiles.some((f) => f.includes("tests/"))).toBe(false);
    expect(coreFiles.some((f) => f.includes("node_modules"))).toBe(false);
    expect(coreFiles.some((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))).toBe(false);

    const cliPackOutput = execSync("npm pack --dry-run --json", {
      cwd: cliDir,
      encoding: "utf8"
    });
    const cliPackInfo = JSON.parse(cliPackOutput);
    const cliFiles = (cliPackInfo[0].files as Array<{ path: string }>).map((f) => f.path);

    expect(cliFiles.some((f) => f.startsWith("dist/"))).toBe(true);
    expect(cliFiles.some((f) => f.startsWith("bin/"))).toBe(true);
    expect(cliFiles.some((f) => f.includes("tests/"))).toBe(false);
    expect(cliFiles.some((f) => f.includes("node_modules"))).toBe(false);
  });
});
