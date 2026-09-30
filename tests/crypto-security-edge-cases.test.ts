import { describe, expect, it } from "bun:test";
import { hashContent, hashObject, sortObjectDeep } from "../packages/core/src/utils/crypto.ts";
import { containsNullByte, isPrototypePollutionKey, isWindowsReservedName } from "../packages/core/src/utils/security.ts";

describe("Crypto, Hashing & Security Utilities Deep Edge Cases", () => {
  describe("hashObject & sortObjectDeep edge cases", () => {
    it("hashes null-prototype objects without error", () => {
      const obj = Object.create(null);
      obj.b = 2;
      obj.a = 1;

      const hash1 = hashObject(obj);
      const hash2 = hashObject({ a: 1, b: 2 });

      expect(hash1).toBe(hash2);
    });

    it("hashes objects with custom toJSON methods deterministically", () => {
      const obj1 = {
        value: 42,
        toJSON() {
          return { normalized: 42 };
        }
      };
      const obj2 = {
        normalized: 42
      };

      expect(hashObject(obj1)).toBe(hashObject(obj2));
    });

    it("hashes deeply nested object structures (50 levels) deterministically", () => {
      let deep1: any = { value: "leaf" };
      let deep2: any = { value: "leaf" };

      for (let i = 0; i < 50; i++) {
        deep1 = { [`level_${i}`]: deep1, extra: i };
        // Reverse property insertion order for deep2
        deep2 = { extra: i, [`level_${i}`]: deep2 };
      }

      expect(hashObject(deep1)).toBe(hashObject(deep2));
    });

    it("handles edge numbers (+0, -0, NaN, Infinity, -Infinity, Max/Min Safe Integer)", () => {
      expect(typeof hashObject(0)).toBe("string");
      expect(typeof hashObject(-0)).toBe("string");
      expect(typeof hashObject(NaN)).toBe("string");
      expect(typeof hashObject(Infinity)).toBe("string");
      expect(typeof hashObject(-Infinity)).toBe("string");
      expect(typeof hashObject(Number.MAX_SAFE_INTEGER)).toBe("string");
      expect(typeof hashObject(Number.MIN_SAFE_INTEGER)).toBe("string");

      // Verify determinism across multiple runs
      expect(hashObject(Number.MAX_SAFE_INTEGER)).toBe(hashObject(Number.MAX_SAFE_INTEGER));
      expect(hashObject(NaN)).toBe(hashObject(NaN));
    });

    it("handles arrays with mixed types and sparse slots", () => {
      const mixed = [null, undefined, 0, false, "", {}, []];
      const h1 = hashObject(mixed);
      const h2 = hashObject([null, undefined, 0, false, "", {}, []]);
      expect(h1).toBe(h2);

      const sparse: any[] = [1];
      sparse[3] = 4; // slot 1 and 2 are empty/sparse
      expect(typeof hashObject(sparse)).toBe("string");
    });

    it("ignores symbol properties on objects without throwing", () => {
      const sym = Symbol("private");
      const obj = {
        name: "test",
        [sym]: "hidden"
      };

      const hash = hashObject(obj);
      expect(hash).toBe(hashObject({ name: "test" }));
    });
  });

  describe("isWindowsReservedName exhaustive device names & false-positive guards", () => {
    it("detects all standard Windows DOS device names in uppercase, lowercase, and mixed-case", () => {
      const reservedBases = [
        "con", "prn", "aux", "nul",
        "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
        "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
      ];

      for (const base of reservedBases) {
        expect(isWindowsReservedName(base)).toBe(true);
        expect(isWindowsReservedName(base.toUpperCase())).toBe(true);
        expect(isWindowsReservedName(`${base}.txt`)).toBe(true);
        expect(isWindowsReservedName(`${base}.tar.gz`)).toBe(true);
        expect(isWindowsReservedName(`path/to/${base}`)).toBe(true);
        expect(isWindowsReservedName(`nested\\dir\\${base}.json`)).toBe(true);
      }
    });

    it("does not false-positive on valid filenames starting with or containing reserved words", () => {
      const safeNames = [
        "connect.ts",
        "connection.js",
        "console.log",
        "conflict.json",
        "printer.py",
        "auxiliary.ts",
        "aux-cable.md",
        "null.js",
        "nullable.ts",
        "com10.ts",
        "com0.ts",
        "lpt0.ts",
        "lpt10.ts",
        "prompt.md",
        "con_schema.json"
      ];

      for (const name of safeNames) {
        expect(isWindowsReservedName(name)).toBe(false);
      }
    });

    it("returns false for non-string or empty inputs", () => {
      expect(isWindowsReservedName("" as any)).toBe(false);
      expect(isWindowsReservedName(null as any)).toBe(false);
      expect(isWindowsReservedName(undefined as any)).toBe(false);
      expect(isWindowsReservedName(123 as any)).toBe(false);
      expect(isWindowsReservedName({} as any)).toBe(false);
    });
  });

  describe("containsNullByte null-poisoning defenses", () => {
    it("detects null bytes anywhere in strings", () => {
      expect(containsNullByte("\0start")).toBe(true);
      expect(containsNullByte("middle\0text")).toBe(true);
      expect(containsNullByte("end\0")).toBe(true);
      expect(containsNullByte("\x00")).toBe(true);
      expect(containsNullByte("\u0000")).toBe(true);
    });

    it("does not false-positive on escaped backslash-zero literal sequences", () => {
      // Literal string containing backslash and digit 0: "path\0\file" -> path\\0\\file
      expect(containsNullByte("path\\0\\file")).toBe(false);
      expect(containsNullByte("safe-string")).toBe(false);
      expect(containsNullByte("")).toBe(false);
    });

    it("returns false for non-string inputs", () => {
      expect(containsNullByte(null)).toBe(false);
      expect(containsNullByte(undefined)).toBe(false);
      expect(containsNullByte(0)).toBe(false);
      expect(containsNullByte({})).toBe(false);
      expect(containsNullByte([])).toBe(false);
    });
  });
});
