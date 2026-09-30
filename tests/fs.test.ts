import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  atomicWriteFileAsync,
  atomicWriteFileSync,
  collectDirectoryFilesAsync,
  isIgnoredPath
} from "../packages/core/src/utils/fs.ts";

describe("High-Efficiency File Engine", () => {
  it("filters out default ignored patterns like node_modules and .git", () => {
    expect(isIgnoredPath(".git")).toBe(true);
    expect(isIgnoredPath(".git/config")).toBe(true);
    expect(isIgnoredPath("node_modules")).toBe(true);
    expect(isIgnoredPath("node_modules/pkg/index.js")).toBe(true);
    expect(isIgnoredPath(".DS_Store")).toBe(true);
    expect(isIgnoredPath("dist/bundle.js")).toBe(true);
    expect(isIgnoredPath("src/index.ts")).toBe(false);
    expect(isIgnoredPath("plugin/code-search.ts")).toBe(false);
    // Extensions
    expect(isIgnoredPath("error.log")).toBe(true);
    expect(isIgnoredPath("src/error.log")).toBe(true);
    expect(isIgnoredPath("build.tmp")).toBe(true);
    expect(isIgnoredPath("module.pyc")).toBe(true);
    expect(isIgnoredPath("")).toBe(false);
    expect(isIgnoredPath("   ")).toBe(false);
  });

  it("supports custom ignore rules across segments, extensions, and paths", () => {
    expect(isIgnoredPath("custom-dir/file.txt", ["custom-dir"])).toBe(true);
    expect(isIgnoredPath("src/custom-dir/file.txt", ["custom-dir"])).toBe(true);
    expect(isIgnoredPath("file.bak", ["*.bak"])).toBe(true);
    expect(isIgnoredPath("src/deep/file.bak", ["*.bak"])).toBe(true);
    expect(isIgnoredPath("deep/nested/secret/key.pem", ["deep/nested/secret"])).toBe(true);
    expect(isIgnoredPath("deep/nested/other/file.txt", ["deep/nested/secret"])).toBe(false);
    expect(isIgnoredPath("safe-file.ts", ["custom-dir", "*.bak"])).toBe(false);
  });

  it("handles gitignore patterns with leading, trailing slashes and windows separators", () => {
    expect(isIgnoredPath("vendor/bundle/app.js", ["vendor/bundle/"])).toBe(true);
    expect(isIgnoredPath("vendor/bundle/nested/lib.js", ["vendor/bundle/"])).toBe(true);
    expect(isIgnoredPath("dist/bundle.js", ["/dist/"])).toBe(true);
    expect(isIgnoredPath("dist/sub/bundle.js", ["dist/"])).toBe(true);
    expect(isIgnoredPath("coverage/lcov.info", ["/coverage"])).toBe(true);
    expect(isIgnoredPath("src/app.ts", ["/dist/", "vendor/bundle/"])).toBe(false);
  });

  it("collectDirectoryFilesAsync collects files concurrently while skipping ignored dirs", async () => {
    const tmp = path.join(os.tmpdir(), "smcp-fs-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
    fs.mkdirSync(path.join(tmp, "src", "nested"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", "junk"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".git", "objects"), { recursive: true });

    fs.writeFileSync(path.join(tmp, "src", "a.ts"), "content-a");
    fs.writeFileSync(path.join(tmp, "src", "nested", "b.ts"), "content-b");
    fs.writeFileSync(path.join(tmp, "node_modules", "junk", "bad.js"), "junk");
    fs.writeFileSync(path.join(tmp, ".git", "objects", "obj.dat"), "git-data");

    const files = await collectDirectoryFilesAsync(tmp);
    expect(Object.keys(files)).toContain("src/a.ts");
    expect(Object.keys(files)).toContain("src/nested/b.ts");
    expect(Object.keys(files)).not.toContain("node_modules/junk/bad.js");
    expect(Object.keys(files)).not.toContain(".git/objects/obj.dat");
    expect(files["src/a.ts"]).toBe("content-a");
    expect(files["src/nested/b.ts"]).toBe("content-b");
  });

  it("collectDirectoryFilesAsync skips files exceeding maxFileSize", async () => {
    const tmp = path.join(os.tmpdir(), "smcp-fs-size-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "small.txt"), "hello");
    fs.writeFileSync(path.join(tmp, "large.txt"), "x".repeat(1024 * 50)); // 50KB

    const files = await collectDirectoryFilesAsync(tmp, { maxFileSize: 1024 * 10 }); // 10KB limit
    expect(files["small.txt"]).toBe("hello");
    expect(files["large.txt"]).toBeUndefined();
  });

  it("collectDirectoryFilesAsync safely handles concurrency <= 0 without hanging", async () => {
    const tmp = path.join(os.tmpdir(), "smcp-fs-concurrency-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "file.txt"), "concurrency test");

    const files = await collectDirectoryFilesAsync(tmp, { concurrency: 0 });
    expect(files["file.txt"]).toBe("concurrency test");
  });

  it("atomicWriteFileAsync writes files safely and non-destructively", async () => {
    const tmpFile = path.join(os.tmpdir(), "smcp-write-test-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".txt");
    await atomicWriteFileAsync(tmpFile, "hello world async");
    expect(fs.readFileSync(tmpFile, "utf8")).toBe("hello world async");
  });

  it("atomicWriteFileAsync creates deeply nested parent directories", async () => {
    const tmpFile = path.join(
      os.tmpdir(),
      "smcp-deep-" + Date.now(),
      "a", "b", "c",
      "test.txt"
    );
    await atomicWriteFileAsync(tmpFile, "nested content");
    expect(fs.readFileSync(tmpFile, "utf8")).toBe("nested content");
  });

  it("atomicWriteFileSync preserves file mode across rewrites", () => {
    const tmpFile = path.join(
      os.tmpdir(),
      "smcp-mode-test-" + Date.now() + ".json"
    );
    atomicWriteFileSync(tmpFile, '{"key":"initial"}', { mode: 0o600 });
    expect(fs.statSync(tmpFile).mode & 0o777).toBe(0o600);

    atomicWriteFileSync(tmpFile, '{"key":"updated"}');
    expect(fs.statSync(tmpFile).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(tmpFile, "utf8")).toBe('{"key":"updated"}');
  });
});
