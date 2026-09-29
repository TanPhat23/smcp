import { describe, expect, it } from "bun:test";
import { hashContent, hashObject, sortObjectDeep } from "../packages/core/src/utils/crypto.ts";
import { expandHome } from "../packages/core/src/utils/paths.ts";
import os from "node:os";
import path from "node:path";

describe("Crypto Utilities", () => {
  it("hashes content deterministically with sha256", () => {
    const hash1 = hashContent("hello world");
    const hash2 = hashContent("hello world");
    const hash3 = hashContent("different content");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64);
  });

  it("verifies known NIST SHA-256 test vectors", () => {
    // NIST test vector for empty string ""
    expect(hashContent("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    // NIST test vector for "abc"
    expect(hashContent("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
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

  it("sorts objects with __proto__ key without polluting Object.prototype", () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"b":2,"a":1}');
    const sorted = sortObjectDeep(payload) as Record<string, unknown>;

    // Verify prototype was not polluted
    expect(({} as any).polluted).toBeUndefined();
    // Verify __proto__ is maintained as an own property
    expect(Object.prototype.hasOwnProperty.call(sorted, "__proto__")).toBe(true);
    expect(sorted.__proto__).toEqual({ polluted: true });
    // Verify JSON serialization includes __proto__ and keys are sorted deterministically
    expect(JSON.stringify(sorted)).toBe('{"__proto__":{"polluted":true},"a":1,"b":2}');
  });

  it("handles undefined and non-serializable values without throwing", () => {
    expect(() => hashObject(undefined)).not.toThrow();
    expect(hashObject(undefined)).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(() => hashObject(() => {})).not.toThrow();
    expect(hashObject(() => {})).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});

describe("Path Expansion Utilities", () => {
  it("expands home directory tilde", () => {
    const expanded = expandHome("~/test/path");
    expect(expanded).toBe(path.join(os.homedir(), "test", "path"));
    expect(expandHome("/absolute/path")).toBe(path.resolve("/absolute/path"));
  });

  it("expands home directory with backslash tilde", () => {
    const expanded = expandHome("~\\test\\path");
    expect(expanded).toBe(path.join(os.homedir(), "test", "path"));
    expect(expandHome("~")).toBe(os.homedir());
  });

  it("expands %APPDATA% when process.env.APPDATA is set", () => {
    const originalAppData = process.env.APPDATA;
    try {
      const mockAppData = path.join(os.homedir(), "custom-appdata");
      process.env.APPDATA = mockAppData;
      const expanded = expandHome("%APPDATA%/Claude/claude_desktop_config.json");
      expect(expanded).toBe(
        path.resolve(path.join(mockAppData, "Claude", "claude_desktop_config.json"))
      );
    } finally {
      if (originalAppData === undefined) {
        delete process.env.APPDATA;
      } else {
        process.env.APPDATA = originalAppData;
      }
    }
  });

  it("expands %APPDATA% fallback when process.env.APPDATA is unset", () => {
    const originalAppData = process.env.APPDATA;
    try {
      delete process.env.APPDATA;
      const expectedFallback = path.resolve(
        path.join(os.homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json")
      );
      const expanded = expandHome("%APPDATA%/Claude/claude_desktop_config.json");
      expect(expanded).toBe(expectedFallback);
    } finally {
      if (originalAppData === undefined) {
        delete process.env.APPDATA;
      } else {
        process.env.APPDATA = originalAppData;
      }
    }
  });

  it("expands %APPDATA% safely without regex replacement token hazards", () => {
    const originalAppData = process.env.APPDATA;
    try {
      const mockAppData = path.join(os.homedir(), "appdata-$1-special");
      process.env.APPDATA = mockAppData;
      const expanded = expandHome("%APPDATA%/Claude/claude_desktop_config.json");
      expect(expanded).toBe(
        path.resolve(path.join(mockAppData, "Claude", "claude_desktop_config.json"))
      );
    } finally {
      if (originalAppData === undefined) {
        delete process.env.APPDATA;
      } else {
        process.env.APPDATA = originalAppData;
      }
    }
  });
});
