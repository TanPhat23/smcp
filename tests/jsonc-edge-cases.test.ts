import { describe, expect, it } from "bun:test";
import { stripJsonComments } from "../packages/core/src/core/agents/jsonc.ts";

describe("JSONC Parser & Comment Stripping Edge Cases (stripJsonComments)", () => {
  it("preserves URLs with double slashes inside string literals", () => {
    const input = JSON.stringify({
      url: "https://example.com/api//v1//endpoint",
      homepage: "http://localhost:8080//test"
    }, null, 2);

    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed.url).toBe("https://example.com/api//v1//endpoint");
    expect(parsed.homepage).toBe("http://localhost:8080//test");
  });

  it("preserves block comment markers inside string literals", () => {
    const input = `{
      "description": "This is /* not a block comment */ and should remain",
      "wildcard": "file/*/*.ts"
    }`;

    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed.description).toBe("This is /* not a block comment */ and should remain");
    expect(parsed.wildcard).toBe("file/*/*.ts");
  });

  it("handles escaped quotes followed by comment markers correctly", () => {
    const input = `{
      "quote": "He said \\"hello\\" // this is not a comment inside string", // actual comment
      "path": "C:\\\\folder\\\\sub // not a comment" /* block comment */
    }`;

    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed.quote).toBe('He said "hello" // this is not a comment inside string');
    expect(parsed.path).toBe("C:\\folder\\sub // not a comment");
  });

  it("strips single-line comments at the very end of string without trailing newline", () => {
    const input = '{"server": "test"} // end-of-file comment with no newline';
    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed.server).toBe("test");
  });

  it("strips multi-line block comments with multiple asterisks", () => {
    const input = `{
      /*********************************
       * Configuration Header Comment  *
       *********************************/
      "version": 1,
      /*** inline comment ***/ "active": true
    }`;

    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed.version).toBe(1);
    expect(parsed.active).toBe(true);
  });

  it("strips trailing commas in deeply nested objects and arrays", () => {
    const input = `{
      "level1": {
        "level2": {
          "arr": [
            1,
            2,
            3,
          ],
          "obj": {
            "key": "val",
          },
        },
      },
    }`;

    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed.level1.level2.arr).toEqual([1, 2, 3]);
    expect(parsed.level1.level2.obj).toEqual({ key: "val" });
  });

  it("handles Windows CRLF line endings with comments", () => {
    const input = '{\r\n  // Windows comment\r\n  "name": "windows-crlf",\r\n  /* multi\r\nline */\r\n  "port": 3000,\r\n}\r\n';
    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed.name).toBe("windows-crlf");
    expect(parsed.port).toBe(3000);
  });

  it("handles Unicode, emojis, and international characters in comments and strings", () => {
    const input = `{
      // コメント: 日本語テスト 🚀
      "greeting": "こんにちは世界 🌍",
      /*
       * Kommentti: Suomi
       * ääkköset: åäö
       */
      "flag": "🇫🇮"
    }`;

    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed.greeting).toBe("こんにちは世界 🌍");
    expect(parsed.flag).toBe("🇫🇮");
  });

  it("handles empty string and pure comment files gracefully", () => {
    expect(stripJsonComments("")).toBe("");
    expect(stripJsonComments("   \t\n   ")).toBe("   \t\n   ");
    expect(stripJsonComments("// only comment\n// second comment").trim()).toBe("");
    expect(stripJsonComments("/* block comment only */").trim()).toBe("");
  });

  it("preserves empty object keys and empty string values", () => {
    const input = `{
      "": "",
      "nested": {
        "": "empty-key-val",
      },
    }`;

    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed[""]).toBe("");
    expect(parsed.nested[""]).toBe("empty-key-val");
  });

  it("handles complex JSON with mixed comment styles, trailing commas, and escaped paths", () => {
    const input = `// Top header
{
  "mcpServers": {
    "local-node": {
      "command": "node",
      "args": [
        "server.js", // run entrypoint
        "--config=C:\\\\Program Files\\\\App\\\\cfg.json", /* windows path */
      ],
      "env": {
        "DEBUG": "true", // enable debug
      },
    },
  },
}
// Bottom footer`;

    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);

    expect(parsed.mcpServers["local-node"].command).toBe("node");
    expect(parsed.mcpServers["local-node"].args).toEqual([
      "server.js",
      "--config=C:\\Program Files\\App\\cfg.json"
    ]);
    expect(parsed.mcpServers["local-node"].env.DEBUG).toBe("true");
  });
});
