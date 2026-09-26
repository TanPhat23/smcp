import { describe, expect, it } from "bun:test";
import { hashContent, hashObject } from "../src/utils/crypto.ts";
import { expandHome } from "../src/utils/paths.ts";
import os from "node:os";

describe("Crypto & Path Utilities", () => {
  it("hashes content deterministically with sha256", () => {
    const hash1 = hashContent("hello world");
    const hash2 = hashContent("hello world");
    const hash3 = hashContent("different content");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64);
  });

  it("hashes objects deterministically regardless of key order", () => {
    const objA = { b: 2, a: 1 };
    const objB = { a: 1, b: 2 };
    expect(hashObject(objA)).toBe(hashObject(objB));
  });

  it("hashes nested objects deterministically regardless of key order", () => {
    const objA = { z: { y: 2, x: 1 }, a: [1, 2] };
    const objB = { a: [1, 2], z: { x: 1, y: 2 } };
    expect(hashObject(objA)).toBe(hashObject(objB));
  });

  it("expands home directory tilde", () => {
    const expanded = expandHome("~/test/path");
    expect(expanded.startsWith(os.homedir())).toBe(true);
    expect(expandHome("/absolute/path")).toBe("/absolute/path");
  });
});
