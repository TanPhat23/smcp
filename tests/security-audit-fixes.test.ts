import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { loadPackFromSource } from "../packages/core/src/core/pack/loader.ts";
import { setDefaultAxiosAdapter } from "../packages/core/src/core/git-providers/github/client.ts";
import { createGist, updateGist } from "../packages/core/src/core/git-providers/github/gist.ts";
import { commitFilesToRepo } from "../packages/core/src/core/git-providers/github/repo.ts";
import { getAuthConfig } from "../packages/core/src/core/state/auth.ts";
import "../packages/core/src/core/git-providers/index.ts";

describe("credential scoping in pack loading", () => {
  let origToken: string | undefined;
  let origGh: string | undefined;
  const requests: Array<{ url: string; headers: Record<string, unknown> }> = [];

  beforeEach(() => {
    origToken = process.env.GITHUB_TOKEN;
    origGh = process.env.GH_TOKEN;
    process.env.GITHUB_TOKEN = "ghp_SECRETSECRET";
    requests.length = 0;
    setDefaultAxiosAdapter(((config: any) => {
      const h = config.headers?.toJSON ? config.headers.toJSON() : config.headers;
      requests.push({ url: String(config.baseURL ?? "") + String(config.url ?? ""), headers: h });
      const e: any = new Error("stop");
      e.config = config;
      return Promise.reject(e);
    }) as any);
  });

  afterEach(() => {
    setDefaultAxiosAdapter(undefined);
    if (origToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = origToken;
    if (origGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = origGh;
  });

  for (const src of ["https://gitlab.evil.test/o/r", "https://my-gitea-evil.test/o/r", "gitea:evil.test/o/r", "gitlab:evil.test/g/p/x"]) {
    it(`never sends the GitHub token to ${src}`, async () => {
      await loadPackFromSource(src, { noCache: true }).catch(() => {});
      expect(requests.filter((r) => !r.url.startsWith("https://api.github.com"))).toEqual([]);
      expect(JSON.stringify(requests)).not.toContain("ghp_SECRETSECRET");
    });
  }

  it("still authenticates GitHub repositories with the GitHub token", async () => {
    await loadPackFromSource("https://github.com/o/r", { noCache: true }).catch(() => {});
    expect(requests[0].url).toBe("https://api.github.com/repos/o/r");
    expect(String(requests[0].headers.Authorization)).toBe("Bearer ghp_SECRETSECRET");
  });

  it("honours GH_TOKEN like getAuthToken does", () => {
    delete process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = "ghp_fromGH";
    expect(getAuthConfig().githubToken).toBe("ghp_fromGH");
  });
});

describe("Gist response validation", () => {
  const html = "<html><body>Sign in to continue</body></html>";
  const clientReturning = (data: unknown): any => ({
    post: async () => ({ data, status: 200, headers: { "content-type": "text/html" } }),
    patch: async () => ({ data, status: 200, headers: { "content-type": "text/html" } })
  });

  it("rejects non-Gist 2xx bodies instead of returning them", async () => {
    await expect(createGist({ description: "d", public: false, files: {} }, clientReturning(html))).rejects.toThrow(
      /unexpected response from GitHub \(HTTP 200, content-type text\/html, string\)/
    );
    await expect(updateGist("abc123", {}, clientReturning(null))).rejects.toThrow(/unexpected response/);
    // an object without an id still succeeds for updates: the id is already known
    await expect(updateGist("abc123", {}, clientReturning({}))).resolves.toMatchObject({
      id: "abc123",
      html_url: "https://gist.github.com/abc123"
    });
  });

  it("derives html_url from the id when GitHub omits it", async () => {
    const res = await createGist({ description: "d", public: false, files: {} }, clientReturning({ id: "deadbeef" }));
    expect(res.html_url).toBe("https://gist.github.com/deadbeef");
  });

  it("passes a normal response through untouched", async () => {
    const res = await createGist(
      { description: "d", public: true, files: {} },
      clientReturning({ id: "1", html_url: "https://gist.github.com/u/1", extra: 5 })
    );
    expect(res).toEqual({ id: "1", html_url: "https://gist.github.com/u/1", extra: 5 });
  });
});

describe("commitFilesToRepo", () => {
  const notFound = () => Object.assign(new Error("nf"), { isAxiosError: true, response: { status: 404 } });
  const make = (opts: { branchMissing?: boolean; refError?: number }) => {
    const calls: string[] = [];
    const client: any = {
      get: async (u: string) => {
        calls.push("GET " + u);
        if (u === "/repos/o/r") return { data: { id: 1, name: "r", full_name: "o/r", html_url: "h", default_branch: "main" } };
        if (u.includes("/git/ref/heads/newbranch")) {
          if (opts.refError) throw Object.assign(new Error("e"), { isAxiosError: true, response: { status: opts.refError } });
          throw notFound();
        }
        if (u.includes("/git/ref/heads/")) return { data: { object: { sha: "c1" } } };
        if (u.includes("/git/commits/")) return { data: { tree: { sha: "t1" } } };
        throw new Error("unexpected " + u);
      },
      post: async (u: string) => ({ data: (calls.push("POST " + u), { sha: "n" }) }),
      patch: async (u: string) => ({ data: (calls.push("PATCH " + u), {}) })
    };
    return { client, calls };
  };

  it("creates the ref (POST) when the target branch does not exist yet", async () => {
    const { client, calls } = make({});
    await commitFilesToRepo({ owner: "o", repo: "r", branch: "newbranch", message: "m", files: { "a.md": "x" }, client });
    expect(calls).toContain("POST /repos/o/r/git/refs");
    expect(calls.some((c) => c.startsWith("PATCH"))).toBe(false);
  });

  it("surfaces auth/rate-limit errors instead of treating the repo as empty", async () => {
    const { client, calls } = make({ refError: 403 });
    await expect(
      commitFilesToRepo({ owner: "o", repo: "r", branch: "newbranch", message: "m", files: { "a.md": "x" }, client })
    ).rejects.toThrow();
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
});
