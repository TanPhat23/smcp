import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  atomicWriteFileAsync,
  collectDirectoryFilesAsync,
  isIgnoredPath,
  pLimit
} from "../packages/core/src/utils/fs.ts";

describe("Filesystem Engine Concurrency, Symlinks & Deep Trees Stress", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      "smcp-fs-stress-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles 50 concurrent atomic writes to the same destination without file corruption", async () => {
    const targetFile = path.join(tmpDir, "concurrent", "shared-target.json");

    // Launch 50 concurrent writers with different JSON payloads
    const writes = Array.from({ length: 50 }, (_, i) => {
      const payload = JSON.stringify({ writerId: i, timestamp: Date.now(), buffer: "x".repeat(500) });
      return atomicWriteFileAsync(targetFile, payload);
    });

    await Promise.all(writes);

    expect(fs.existsSync(targetFile)).toBe(true);
    const raw = fs.readFileSync(targetFile, "utf8");
    const parsed = JSON.parse(raw);
    expect(typeof parsed.writerId).toBe("number");
    expect(parsed.writerId).toBeGreaterThanOrEqual(0);
    expect(parsed.writerId).toBeLessThan(50);
    expect(parsed.buffer).toBe("x".repeat(500));
  });

  it("handles 50 concurrent atomic writes to distinct files in uncreated parent directories", async () => {
    const writes = Array.from({ length: 50 }, (_, i) => {
      const targetFile = path.join(tmpDir, `deep-concurrent-${i % 5}`, `sub-${i}`, `file-${i}.txt`);
      return atomicWriteFileAsync(targetFile, `content-${i}`);
    });

    await Promise.all(writes);

    for (let i = 0; i < 50; i++) {
      const targetFile = path.join(tmpDir, `deep-concurrent-${i % 5}`, `sub-${i}`, `file-${i}.txt`);
      expect(fs.existsSync(targetFile)).toBe(true);
      expect(fs.readFileSync(targetFile, "utf8")).toBe(`content-${i}`);
    }
  });

  it("traverses deeply nested directory hierarchies (30 levels deep) without stack overflow", async () => {
    let currentDir = tmpDir;
    for (let i = 1; i <= 30; i++) {
      currentDir = path.join(currentDir, `level-${i}`);
    }
    fs.mkdirSync(currentDir, { recursive: true });

    const deepFile = path.join(currentDir, "bottom.txt");
    fs.writeFileSync(deepFile, "hello from the abyss", "utf8");

    const collected = await collectDirectoryFilesAsync(tmpDir);
    const keys = Object.keys(collected);

    expect(keys.length).toBe(1);
    expect(keys[0].endsWith("bottom.txt")).toBe(true);
    expect(collected[keys[0]]).toBe("hello from the abyss");
  });

  it("safely handles circular directory symlinks without infinite loops or hanging", async () => {
    const parentDir = path.join(tmpDir, "circular-test");
    fs.mkdirSync(parentDir, { recursive: true });

    const normalFile = path.join(parentDir, "normal.txt");
    fs.writeFileSync(normalFile, "normal file content", "utf8");

    const loopSymlink = path.join(parentDir, "loop");
    try {
      fs.symlinkSync(parentDir, loopSymlink, "dir");
    } catch {
      // If symlink creation fails due to platform permissions, skip symlink creation
      return;
    }

    const collected = await collectDirectoryFilesAsync(parentDir);
    expect(collected["normal.txt"]).toBe("normal file content");
    // Verify symlink loop was not traversed infinitely
    expect(Object.keys(collected).length).toBe(1);
  });

  it("safely ignores broken symlinks pointing to non-existent targets", async () => {
    const testDir = path.join(tmpDir, "broken-symlinks");
    fs.mkdirSync(testDir, { recursive: true });

    fs.writeFileSync(path.join(testDir, "valid.txt"), "valid content", "utf8");

    try {
      fs.symlinkSync(path.join(testDir, "non-existent-target.txt"), path.join(testDir, "broken-link.txt"));
    } catch {
      return;
    }

    const collected = await collectDirectoryFilesAsync(testDir);
    expect(collected["valid.txt"]).toBe("valid content");
    expect(collected["broken-link.txt"]).toBeUndefined();
  });

  it("collects zero-byte empty files properly", async () => {
    const testDir = path.join(tmpDir, "empty-files");
    fs.mkdirSync(testDir, { recursive: true });

    fs.writeFileSync(path.join(testDir, "empty.txt"), "", "utf8");
    fs.writeFileSync(path.join(testDir, "non-empty.txt"), "hello", "utf8");

    const collected = await collectDirectoryFilesAsync(testDir);
    expect(collected["empty.txt"]).toBe("");
    expect(collected["non-empty.txt"]).toBe("hello");
  });

  it("handles Unicode, spaces, and emojis in filenames properly", async () => {
    const testDir = path.join(tmpDir, "unicode-files");
    fs.mkdirSync(testDir, { recursive: true });

    fs.writeFileSync(path.join(testDir, "file with spaces.txt"), "spaces", "utf8");
    fs.writeFileSync(path.join(testDir, "🚀-launch.md"), "launch rocket", "utf8");
    fs.writeFileSync(path.join(testDir, "Café_latte.json"), '{"beverage": "coffee"}', "utf8");

    const collected = await collectDirectoryFilesAsync(testDir);
    expect(collected["file with spaces.txt"]).toBe("spaces");
    expect(collected["🚀-launch.md"]).toBe("launch rocket");
    expect(collected["Café_latte.json"]).toBe('{"beverage": "coffee"}');
  });

  it("respects exact maxFileSize threshold boundaries", async () => {
    const testDir = path.join(tmpDir, "boundary-files");
    fs.mkdirSync(testDir, { recursive: true });

    const maxFileSize = 100;
    fs.writeFileSync(path.join(testDir, "under.txt"), "a".repeat(99), "utf8");
    fs.writeFileSync(path.join(testDir, "exact.txt"), "b".repeat(100), "utf8");
    fs.writeFileSync(path.join(testDir, "over.txt"), "c".repeat(101), "utf8");

    const collected = await collectDirectoryFilesAsync(testDir, { maxFileSize });
    expect(collected["under.txt"]).toBe("a".repeat(99));
    expect(collected["exact.txt"]).toBe("b".repeat(100));
    expect(collected["over.txt"]).toBeUndefined();
  });

  it("handles isIgnoredPath edge cases with redundant slashes and nested dotfiles", () => {
    expect(isIgnoredPath("")).toBe(false);
    expect(isIgnoredPath("./node_modules/package/index.js")).toBe(true);
    expect(isIgnoredPath("src//deep//node_modules//file.js")).toBe(true);
    expect(isIgnoredPath(".git/HEAD")).toBe(true);
    expect(isIgnoredPath("folder/.DS_Store")).toBe(true);
    expect(isIgnoredPath("nested/dir/.turbo/cache.bin")).toBe(true);
    expect(isIgnoredPath("app/build/output.log")).toBe(true);
    expect(isIgnoredPath("normal/file.ts")).toBe(false);
    expect(isIgnoredPath("custom/path/secret.env", ["custom/path"])).toBe(true);
    expect(isIgnoredPath("custom/path-other/safe.ts", ["custom/path"])).toBe(false);
  });
});
