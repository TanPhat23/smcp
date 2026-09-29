import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import axios, { AxiosError } from "axios";
import {
  clearHttpClientCache,
  createHttpClient,
  formatHttpError,
  getOrCreateAxiosInstance,
  HttpClient,
  setDefaultHttpAdapter
} from "../src/core/http.ts";

describe("HttpClient (src/core/http.ts)", () => {
  let capturedConfig: any = null;

  afterEach(() => {
    setDefaultHttpAdapter(undefined);
    capturedConfig = null;
  });

  it("constructs HttpClient with default and custom options", () => {
    const client = new HttpClient({
      baseURL: "https://example.com/api",
      headers: { "X-Custom": "Value" },
      timeoutMs: 5000
    });

    expect(client.raw.defaults.baseURL).toBe("https://example.com/api");
    expect(client.raw.defaults.timeout).toBe(5000);
    expect(client.raw.defaults.headers["X-Custom"]).toBe("Value");
    expect(client.raw.defaults.headers["User-Agent"]).toBe("smcp-cli");
    expect(client.interceptors).toBeDefined();
  });

  it("performs GET request and returns AxiosResponse", async () => {
    setDefaultHttpAdapter(async (config) => {
      capturedConfig = config;
      return {
        data: { message: "success" },
        status: 200,
        statusText: "OK",
        headers: {},
        config
      } as any;
    });

    const client = createHttpClient();
    const res = await client.get("https://api.example.com/items");

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: "success" });
    expect(capturedConfig.method).toBe("get");
    expect(capturedConfig.url).toBe("https://api.example.com/items");
  });

  it("performs POST, PUT, PATCH, and DELETE requests", async () => {
    const methodsUsed: string[] = [];

    setDefaultHttpAdapter(async (config) => {
      methodsUsed.push(config.method?.toLowerCase() || "");
      return {
        data: { status: "ok" },
        status: 200,
        statusText: "OK",
        headers: {},
        config
      } as any;
    });

    const client = createHttpClient();
    await client.post("https://api.example.com/items", { name: "item1" });
    await client.put("https://api.example.com/items/1", { name: "updated" });
    await client.patch("https://api.example.com/items/1", { name: "patched" });
    await client.delete("https://api.example.com/items/1");

    expect(methodsUsed).toEqual(["post", "put", "patch", "delete"]);
  });

  it("fetchJson returns parsed data directly", async () => {
    setDefaultHttpAdapter(async (config) => {
      return {
        data: { items: [1, 2, 3] },
        status: 200,
        statusText: "OK",
        headers: {},
        config
      } as any;
    });

    const client = createHttpClient();
    const data = await client.fetchJson<{ items: number[] }>("https://api.example.com/data");
    expect(data.items).toEqual([1, 2, 3]);
  });

  it("fetchText returns string body directly", async () => {
    setDefaultHttpAdapter(async (config) => {
      return {
        data: "# Markdown Title\nSome content",
        status: 200,
        statusText: "OK",
        headers: {},
        config
      } as any;
    });

    const client = createHttpClient();
    const text = await client.fetchText("https://example.com/doc.md");
    expect(text).toContain("# Markdown Title");
  });

  describe("formatHttpError", () => {
    it("formats AxiosError with status, statusText, and message object", () => {
      const err = new AxiosError(
        "Request failed",
        "ERR_BAD_REQUEST",
        {} as any,
        null,
        {
          status: 404,
          statusText: "Not Found",
          data: { message: "Resource not found" },
          headers: {},
          config: {} as any
        }
      );

      const formatted = formatHttpError(err, "Fetch failed");
      expect(formatted).toContain("Fetch failed");
      expect(formatted).toContain("404");
      expect(formatted).toContain("Not Found");
      expect(formatted).toContain("Resource not found");
    });

    it("formats AxiosError with HTML string data and truncates it", () => {
      const err = new AxiosError(
        "Request failed",
        "ERR_BAD_RESPONSE",
        {} as any,
        null,
        {
          status: 502,
          statusText: "Bad Gateway",
          data: "<html>" + "Error".repeat(60) + "</html>",
          headers: {},
          config: {} as any
        }
      );

      const formatted = formatHttpError(err, "Gateway error");
      expect(formatted).toContain("502");
      expect(formatted).toContain("Bad Gateway");
      expect(formatted).toContain("...");
      expect(formatted.length).toBeLessThan(300);
    });

    it("formats standard Error", () => {
      const err = new Error("Connection timeout");
      const formatted = formatHttpError(err, "Request error");
      expect(formatted).toBe("Request error: Connection timeout");
    });

    it("formats non-error values", () => {
      const formatted = formatHttpError("Something went wrong", "Error");
      expect(formatted).toBe("Error: Something went wrong");
    });
  });

  describe("Singleton Axios instance & cache invalidation", () => {
    it("reuses identical Axios instance across multiple createHttpClient() and new HttpClient() calls with same config", () => {
      const h1 = createHttpClient({ baseURL: "https://api.test", timeoutMs: 5000 });
      const h2 = createHttpClient({ baseURL: "https://api.test", timeoutMs: 5000 });
      const h3 = new HttpClient({ baseURL: "https://api.test", timeoutMs: 5000 });

      expect(h1.raw).toBe(h2.raw);
      expect(h2.raw).toBe(h3.raw);
    });

    it("reuses default Axios instance when options are omitted", () => {
      const d1 = createHttpClient();
      const d2 = createHttpClient();
      const d3 = new HttpClient();

      expect(d1.raw).toBe(d2.raw);
      expect(d2.raw).toBe(d3.raw);
    });

    it("creates different Axios instances for different baseURL, timeoutMs, or headers", () => {
      const base = createHttpClient({ baseURL: "https://api.test", timeoutMs: 5000 });
      const diffUrl = createHttpClient({ baseURL: "https://diff.test", timeoutMs: 5000 });
      const diffTimeout = createHttpClient({ baseURL: "https://api.test", timeoutMs: 10000 });
      const diffHeaders = createHttpClient({
        baseURL: "https://api.test",
        timeoutMs: 5000,
        headers: { "X-Extra": "1" }
      });

      expect(diffUrl.raw).not.toBe(base.raw);
      expect(diffTimeout.raw).not.toBe(base.raw);
      expect(diffHeaders.raw).not.toBe(base.raw);
    });

    it("normalizes header key ordering so different insertion orders reuse same instance", () => {
      const c1 = createHttpClient({
        headers: { A: "1", B: "2" }
      });
      const c2 = createHttpClient({
        headers: { B: "2", A: "1" }
      });

      expect(c1.raw).toBe(c2.raw);
    });

    it("supports explicit axiosInstance injection in HttpClient and createHttpClient", () => {
      const customAxios = axios.create();
      const client = new HttpClient({ axiosInstance: customAxios });
      const created = createHttpClient({ axiosInstance: customAxios });

      expect(client.raw).toBe(customAxios);
      expect(created.raw).toBe(customAxios);
    });

    it("does not cache explicitly injected axiosInstance", () => {
      const customAxios = axios.create();
      createHttpClient({ baseURL: "https://no-cache.test", axiosInstance: customAxios });

      const standard = createHttpClient({ baseURL: "https://no-cache.test" });
      expect(standard.raw).not.toBe(customAxios);
    });

    it("invalidates cache when clearHttpClientCache() is called", () => {
      const before = createHttpClient({ baseURL: "https://cache-invalidation.test" });
      clearHttpClientCache();
      const after = createHttpClient({ baseURL: "https://cache-invalidation.test" });

      expect(after.raw).not.toBe(before.raw);

      const after2 = createHttpClient({ baseURL: "https://cache-invalidation.test" });
      expect(after2.raw).toBe(after.raw);
    });

    it("invalidates cache when setDefaultHttpAdapter() is called", () => {
      const before = createHttpClient();
      setDefaultHttpAdapter(async (config) => ({
        status: 200,
        data: {},
        statusText: "OK",
        headers: {},
        config
      } as any));

      const after = createHttpClient();
      expect(after.raw).not.toBe(before.raw);
    });
  });
});
