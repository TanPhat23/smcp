import fs from "node:fs";
import axios, {
  type AxiosAdapter,
  type AxiosInstance,
  isAxiosError
} from "axios";
import { ManifestSchema, type Manifest } from "../types/index.ts";
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  HttpClient,
  createHttpClient,
  setDefaultHttpAdapter,
  clearHttpClientCache,
  getOrCreateAxiosInstance
} from "./http.ts";

export { HttpClient, createHttpClient, clearHttpClientCache, getOrCreateAxiosInstance };
export const DEFAULT_TIMEOUT_MS = DEFAULT_HTTP_TIMEOUT_MS;

export function clearGitHubClientCache(): void {
  clearHttpClientCache();
}

export function setDefaultAxiosAdapter(adapter: AxiosAdapter | undefined): void {
  setDefaultHttpAdapter(adapter);
  clearGitHubClientCache();
}

export interface GitHubGistFile {
  content: string;
  filename?: string;
}

export interface CreateGistPayload {
  description: string;
  public: boolean;
  files: Record<string, { content: string }>;
}

export interface GistResponseFile {
  filename?: string;
  type?: string;
  language?: string;
  raw_url?: string;
  size?: number;
  truncated?: boolean;
  content: string;
}

export interface GistResponse {
  id: string;
  html_url: string;
  description?: string;
  files: Record<string, GistResponseFile>;
  [key: string]: unknown;
}

export
interface GitHubClientOptions {
  timeoutMs?: number;
  axiosInstance?: AxiosInstance;
  adapter?: AxiosAdapter;
  baseURL?: string;
}

export function createGitHubAxios(
  token?: string,
  options?: GitHubClientOptions | number
): AxiosInstance {
  const clientOptions: GitHubClientOptions =
    typeof options === "number" ? { timeoutMs: options } : options || {};

  if (clientOptions.axiosInstance) {
    return clientOptions.axiosInstance;
  }

  const timeoutMs = clientOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const adapter = clientOptions.adapter;
  const baseURL = clientOptions.baseURL || "https://api.github.com";

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "smcp-cli",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const http = createHttpClient({
    baseURL,
    timeoutMs,
    adapter,
    headers
  });

  return http.raw;
}

function extractErrorDetail(body: unknown): string {
  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
  }

  if (body && typeof body === "object") {
    const { message, errors } = body as { message?: string; errors?: unknown };
    const errList = Array.isArray(errors)
      ? errors
          .map((e) =>
            typeof e === "object" && e
              ? (e as any).message ||
                ((e as any).field && (e as any).code
                  ? `${(e as any).field} (${(e as any).code})`
                  : JSON.stringify(e))
              : String(e)
          )
          .join(", ")
      : errors
      ? String(errors)
      : "";

    return [message?.trim(), errList].filter(Boolean).join(" - ");
  }

  return "";
}

async function parseResponseBody(
  target: unknown
): Promise<{ status?: number; statusText?: string; data?: unknown }> {
  if (isAxiosError(target) && target.response) {
    return {
      status: target.response.status,
      statusText: target.response.statusText,
      data: target.response.data
    };
  }

  if (target && typeof target === "object" && "status" in target) {
    const res = target as Response;
    let data: unknown;
    if (typeof res.text === "function") {
      try {
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      } catch {
        // Response body could not be read
      }
    } else if ("data" in (res as any)) {
      data = (res as any).data;
    }
    return { status: res.status, statusText: res.statusText, data };
  }

  return {};
}

export async function formatApiError(errOrRes: unknown, defaultMsg: string): Promise<string> {
  if (errOrRes instanceof Error && !isAxiosError(errOrRes)) {
    return `${defaultMsg}: ${errOrRes.message}`;
  }

  const { status, statusText = "", data } = await parseResponseBody(errOrRes);
  const detail = extractErrorDetail(data) || statusText;

  let hint = "";
  if (isAxiosError(errOrRes) && errOrRes.response) {
    const scopes = errOrRes.response.headers?.["x-oauth-scopes"];
    const accepted = errOrRes.response.headers?.["x-accepted-oauth-scopes"];
    if (accepted && scopes && typeof scopes === "string" && !scopes.includes("repo")) {
      hint = ` (Current token scopes: [${scopes}], required: [${accepted}]. Add 'repo' scope at https://github.com/settings/tokens/new?scopes=gist,repo&description=smcp-cli)`;
    }
  }

  const category =
    status === 401 || status === 403
      ? "Auth failed"
      : status !== undefined && status >= 500 && status < 600
      ? "GitHub service unavailable"
      : "";

  const info = [category, detail].filter(Boolean).join(": ") || "Unknown error";
  return `${defaultMsg}: ${status ?? "Error"} ${info}${hint}`;
}

export function parseGistId(gistIdOrUrl: string): string {
  if (!gistIdOrUrl || typeof gistIdOrUrl !== "string" || gistIdOrUrl.trim().length === 0) {
    throw new Error("Invalid Gist ID or URL provided");
  }

  const trimmed = gistIdOrUrl.trim();
  let id = "";

  if (trimmed.includes("://")) {
    try {
      const url = new URL(trimmed);
      let pathname = url.pathname.replace(/\/+$/, "");
      if (pathname.endsWith(".git")) {
        pathname = pathname.slice(0, -4).replace(/\/+$/, "");
      }
      const segments = pathname.split("/").filter(Boolean);
      id = segments[segments.length - 1] || "";
    } catch {
      throw new Error("Invalid Gist ID or URL provided");
    }
  } else {
    let clean = trimmed.split("#")[0].split("?")[0].replace(/\/+$/, "");
    if (clean.endsWith(".git")) {
      clean = clean.slice(0, -4).replace(/\/+$/, "");
    }
    const segments = clean.split("/").filter(Boolean);
    id = segments[segments.length - 1] || "";
  }

  if (!id || !/^[a-fA-F0-9]+$/.test(id)) {
    throw new Error("Invalid Gist ID or URL provided");
  }

  return id;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
}

export function parseGitHubRepo(input: string): GitHubRepoRef | null {
  if (!input || typeof input !== "string" || input.trim().length === 0) {
    return null;
  }
  const trimmed = input.trim();

  // 1. github:owner/repo[#ref]
  if (trimmed.startsWith("github:")) {
    const rest = trimmed.slice(7);
    const [pathPart, hashPart] = rest.split("#");
    const segments = pathPart.split("/").filter(Boolean);
    if (segments.length >= 2) {
      return {
        owner: segments[0],
        repo: segments[1].replace(/\.git$/, ""),
        ref: hashPart || undefined,
        subpath: segments.slice(2).join("/") || undefined
      };
    }
  }

  // 2. https://github.com/owner/repo...
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      if (u.hostname === "github.com" || u.hostname === "www.github.com") {
        let pathname = u.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
        if (pathname.endsWith(".git")) {
          pathname = pathname.slice(0, -4);
        }
        const parts = pathname.split("/").filter(Boolean);
        // Exclude gist.github.com
        if (parts.length >= 2 && parts[0] !== "gist") {
          const owner = parts[0];
          const repo = parts[1];
          if (parts[2] === "tree" && parts[3]) {
            const ref = parts[3];
            const subpath = parts.slice(4).join("/") || undefined;
            return { owner, repo, ref, subpath };
          }
          return { owner, repo };
        }
      }
    } catch {
      return null;
    }
  }

  // 3. owner/repo shorthand (e.g. "TanPhat23/my-pack" or "owner/repo#v1.0")
  if (
    !fs.existsSync(trimmed) &&
    /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:#[a-zA-Z0-9_.-]+)?$/.test(trimmed)
  ) {
    const [pathPart, hashPart] = trimmed.split("#");
    const [owner, repo] = pathPart.split("/");
    return {
      owner,
      repo: repo.replace(/\.git$/, ""),
      ref: hashPart || undefined
    };
  }

  return null;
}

export function isRepoSource(input: string): boolean {
  return parseGitHubRepo(input) !== null;
}

export function generatePackReadme(manifest: Manifest, repoFullName?: string): string {
  const lines: string[] = [
    `# ${manifest.name}`,
    "",
    manifest.description || "AI Agent Skills, MCP Servers, and Plugins managed by smcp.",
    "",
    `**Version:** \`${manifest.version}\`  `,
    `**Managed by:** [smcp](https://github.com/TanPhat23/smcp)  `,
    "",
    "## Quick Install",
    "",
    "```bash",
    `smcp install ${repoFullName ? `https://github.com/${repoFullName}` : manifest.name}`,
    "```",
    ""
  ];

  const servers = Object.keys(manifest.mcpServers || {});
  if (servers.length > 0) {
    lines.push("## MCP Servers", "");
    for (const s of servers) {
      lines.push(`- **${s}**`);
    }
    lines.push("");
  }

  const skills = manifest.skills || [];
  if (skills.length > 0) {
    lines.push("## Agent Skills", "");
    for (const sk of skills) {
      lines.push(`- **${sk.name}**${sk.description ? `: ${sk.description}` : ""}`);
    }
    lines.push("");
  }

  const plugins = manifest.plugins || [];
  if (plugins.length > 0) {
    lines.push("## Plugins", "");
    for (const pl of plugins) {
      const name = typeof pl === "string" ? pl : pl.name;
      lines.push(`- **${name}**`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

export interface RepoPackResult {
  manifest: Manifest;
  rawFiles: Record<string, string>;
  repoFullName: string;
  ref: string;
  htmlUrl: string;
}

export class GitHubClient {
  #token?: string;
  #client: AxiosInstance;

  static parseRepo(input: string): GitHubRepoRef | null {
    return parseGitHubRepo(input);
  }

  static isRepoSource(input: string): boolean {
    return isRepoSource(input);
  }

  constructor(
    token?: string,
    options?: GitHubClientOptions | number
  ) {
    this.#token = token;
    const clientOptions: GitHubClientOptions =
      typeof options === "number" ? { timeoutMs: options } : options || {};
    this.#client = clientOptions.axiosInstance || createGitHubAxios(token, clientOptions);
  }

  get client(): AxiosInstance {
    return this.#client;
  }

  async verifyUser(): Promise<{
    login: string;
    name: string;
    scopes?: string[];
    hasRepoScope?: boolean;
    hasGistScope?: boolean;
    [key: string]: unknown;
  }> {
    try {
      const res = await this.#client.get<{ login: string; name: string }>("/user");
      const scopesHeader = res.headers?.["x-oauth-scopes"];
      let scopes: string[] | undefined = undefined;
      let hasRepoScope: boolean | undefined = undefined;
      let hasGistScope: boolean | undefined = undefined;

      if (typeof scopesHeader === "string") {
        scopes = scopesHeader
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        hasRepoScope = scopes.includes("repo") || scopes.includes("public_repo");
        hasGistScope = scopes.includes("gist");
      }

      return {
        ...res.data,
        scopes,
        hasRepoScope,
        hasGistScope
      };
    } catch (err: unknown) {
      throw new Error(await formatApiError(err, "GitHub Authentication failed"));
    }
  }

  async createGist(
    payload: CreateGistPayload
  ): Promise<{ id: string; html_url: string; [key: string]: unknown }> {
    try {
      const res = await this.#client.post<{ id: string; html_url: string }>("/gists", payload);
      return res.data;
    } catch (err: unknown) {
      throw new Error(await formatApiError(err, "Failed to create Gist"));
    }
  }

  async updateGist(
    gistId: string,
    payload: Partial<CreateGistPayload>
  ): Promise<{ id: string; html_url: string; [key: string]: unknown }> {
    try {
      const res = await this.#client.patch<{ id: string; html_url: string }>(
        `/gists/${encodeURIComponent(gistId)}`,
        payload
      );
      return res.data;
    } catch (err: unknown) {
      throw new Error(await formatApiError(err, `Failed to update Gist ${gistId}`));
    }
  }

  async getRepository(
    owner: string,
    repo: string
  ): Promise<{ id: number; name: string; full_name: string; html_url: string; default_branch: string } | null> {
    try {
      const res = await this.#client.get<{
        id: number;
        name: string;
        full_name: string;
        html_url: string;
        default_branch: string;
      }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
      return res.data;
    } catch (err: unknown) {
      if (isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      throw new Error(await formatApiError(err, `Failed to get repository ${owner}/${repo}`));
    }
  }

  async createRepository(payload: {
    name: string;
    description?: string;
    private?: boolean;
    org?: string;
    auto_init?: boolean;
  }): Promise<{ id: number; name: string; full_name: string; html_url: string; default_branch: string }> {
    try {
      const endpoint = payload.org
        ? `/orgs/${encodeURIComponent(payload.org)}/repos`
        : "/user/repos";
      const res = await this.#client.post<{
        id: number;
        name: string;
        full_name: string;
        html_url: string;
        default_branch: string;
      }>(endpoint, {
        name: payload.name,
        description: payload.description || "",
        private: Boolean(payload.private),
        auto_init: payload.auto_init ?? true
      });
      return res.data;
    } catch (err: unknown) {
      throw new Error(await formatApiError(err, `Failed to create repository ${payload.name}`));
    }
  }

  async commitFilesToRepo(params: {
    owner: string;
    repo: string;
    branch?: string;
    message: string;
    files: Record<string, string>;
    isPublic?: boolean;
    description?: string;
  }): Promise<{ commitSha: string; html_url: string; branch: string }> {
    const { owner, repo, message, files, isPublic = true, description = "" } = params;
    let branch = params.branch;

    // 1. Check if repo exists, create if not
    let repoData = await this.getRepository(owner, repo);
    if (!repoData) {
      repoData = await this.createRepository({
        name: repo,
        description,
        private: !isPublic,
        auto_init: true
      });
    }

    if (!branch) {
      branch = repoData.default_branch || "main";
    }

    // 2. Get latest commit SHA on target branch
    let baseCommitSha: string | undefined;
    let baseTreeSha: string | undefined;

    try {
      const refRes = await this.#client.get<{ object: { sha: string } }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`
      );
      baseCommitSha = refRes.data.object.sha;
      const commitRes = await this.#client.get<{ tree: { sha: string } }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(baseCommitSha)}`
      );
      baseTreeSha = commitRes.data.tree.sha;
    } catch {
      // Branch might not exist yet; try default branch if different
      if (branch !== repoData.default_branch) {
        try {
          const defaultRefRes = await this.#client.get<{ object: { sha: string } }>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(repoData.default_branch)}`
          );
          baseCommitSha = defaultRefRes.data.object.sha;
          const commitRes = await this.#client.get<{ tree: { sha: string } }>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(baseCommitSha)}`
          );
          baseTreeSha = commitRes.data.tree.sha;
        } catch {
          // Empty repo without commits
        }
      }
    }

    // 3. Create tree entries
    const treeEntries = Object.entries(files).map(([filePath, content]) => ({
      path: filePath.replaceAll("\\", "/"),
      mode: "100644" as const,
      type: "blob" as const,
      content
    }));

    const treePayload: { base_tree?: string; tree: typeof treeEntries } = {
      tree: treeEntries
    };
    if (baseTreeSha) {
      treePayload.base_tree = baseTreeSha;
    }

    const treeRes = await this.#client.post<{ sha: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
      treePayload
    );
    const newTreeSha = treeRes.data.sha;

    // 4. Create commit
    const commitPayload: { message: string; tree: string; parents: string[] } = {
      message,
      tree: newTreeSha,
      parents: baseCommitSha ? [baseCommitSha] : []
    };
    const newCommitRes = await this.#client.post<{ sha: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
      commitPayload
    );
    const newCommitSha = newCommitRes.data.sha;

    // 5. Update or create branch reference
    if (baseCommitSha) {
      await this.#client.patch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
        { sha: newCommitSha, force: false }
      );
    } else {
      await this.#client.post(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
        { ref: `refs/heads/${branch}`, sha: newCommitSha }
      );
    }

    return {
      commitSha: newCommitSha,
      html_url: `https://github.com/${owner}/${repo}`,
      branch
    };
  }

  static async fetchRepoFileContent(
    client: AxiosInstance,
    owner: string,
    repo: string,
    ref: string,
    filePath: string,
    blobSha?: string
  ): Promise<string> {
    if (blobSha) {
      try {
        const res = await client.get<{ content: string; encoding: string }>(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(blobSha)}`
        );
        if (res.data?.encoding === "base64" && res.data.content) {
          return Buffer.from(res.data.content, "base64").toString("utf8");
        }
      } catch {
        // Fallback to raw URL
      }
    }

    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${filePath}`;
    const rawRes = await client.get<string>(rawUrl, {
      headers: {
        Accept: "text/plain, */*",
        Authorization: undefined
      },
      responseType: "text",
      transformResponse: [(data) => (typeof data === "string" ? data : String(data))]
    });
    return rawRes.data;
  }

  static async fetchRepoPack(
    source: string,
    token?: string,
    options?: GitHubClientOptions | number
  ): Promise<RepoPackResult> {
    const repoRef = parseGitHubRepo(source);
    if (!repoRef) {
      throw new Error(`Invalid GitHub repository source: ${source}`);
    }

    const { owner, repo, subpath } = repoRef;
    const clientOptions: GitHubClientOptions =
      typeof options === "number" ? { timeoutMs: options } : options || {};
    const client = clientOptions.axiosInstance || createGitHubAxios(token, clientOptions);

    try {
      let ref = repoRef.ref;
      if (!ref) {
        const repoRes = await client.get<{ default_branch: string }>(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
        );
        ref = repoRes.data.default_branch || "main";
      }

      const treeRes = await client.get<{
        sha: string;
        tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number; url: string }>;
      }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`
      );

      const tree = treeRes.data.tree || [];
      const manifestPath = subpath ? `${subpath}/smcp.json` : "smcp.json";
      const manifestItem = tree.find((item) => item.path === manifestPath && item.type === "blob");

      if (!manifestItem) {
        throw new Error(
          `Repository ${owner}/${repo} does not contain an smcp.json manifest file at ${manifestPath}.`
        );
      }

      const manifestContent = await GitHubClient.fetchRepoFileContent(
        client,
        owner,
        repo,
        ref,
        manifestItem.path,
        manifestItem.sha
      );

      const manifest = ManifestSchema.parse(JSON.parse(manifestContent));
      const rawFiles: Record<string, string> = {};
      rawFiles["smcp.json"] = manifestContent;

      const prefix = subpath ? `${subpath}/` : "";
      const blobItems = tree.filter((item) => item.type === "blob" && item.path !== manifestPath);

      const relevantBlobs = blobItems.filter((item) => {
        const rel = prefix ? item.path.slice(prefix.length) : item.path;
        return (
          rel.startsWith("skills/") ||
          rel.startsWith("plugins/") ||
          rel.endsWith(".md") ||
          rel.endsWith(".json")
        );
      });

      await Promise.all(
        relevantBlobs.map(async (blob) => {
          try {
            const content = await GitHubClient.fetchRepoFileContent(
              client,
              owner,
              repo,
              ref,
              blob.path,
              blob.sha
            );
            const relPath = prefix ? blob.path.slice(prefix.length) : blob.path;
            rawFiles[relPath] = content;

            if (relPath.startsWith("skills/")) {
              const parts = relPath.split("/");
              if (parts.length >= 3) {
                const skillName = parts[1];
                const filePart = parts.slice(2).join("_");
                rawFiles[`skills_${skillName}_${filePart}`] = content;
              }
            } else if (relPath.startsWith("plugins/")) {
              const parts = relPath.split("/");
              if (parts.length >= 3) {
                const pluginName = parts[1];
                const filePart = parts.slice(2).join("_");
                rawFiles[`plugins_${pluginName}_${filePart}`] = content;
              }
            }
          } catch {
            // Ignore non-fatal auxiliary file errors
          }
        })
      );

      return {
        manifest,
        rawFiles,
        repoFullName: `${owner}/${repo}`,
        ref,
        htmlUrl: `https://github.com/${owner}/${repo}`
      };
    } catch (err: unknown) {
      throw new Error(await formatApiError(err, `Failed to load GitHub repository pack ${owner}/${repo}`));
    }
  }

  static async fetchGist(
    gistIdOrUrl: string,
    token?: string,
    options?: GitHubClientOptions | number
  ): Promise<GistResponse> {
    const id = parseGistId(gistIdOrUrl);
    const clientOptions: GitHubClientOptions =
      typeof options === "number" ? { timeoutMs: options } : options || {};
    const client = clientOptions.axiosInstance || createGitHubAxios(token, clientOptions);
    try {
      const res = await client.get<GistResponse>(`/gists/${encodeURIComponent(id)}`);
      const gist = res.data;

      // Handle truncated files (GitHub Gist API truncates file content over ~64KB)
      if (gist && gist.files) {
        const truncatedFiles = Object.values(gist.files).filter(
          (file) => (file.truncated || !file.content) && Boolean(file.raw_url)
        );
        if (truncatedFiles.length > 0) {
          await Promise.all(
            truncatedFiles.map(async (file) => {
              try {
                const rawRes = await client.get<string>(file.raw_url!, {
                  headers: {
                    Accept: "text/plain, */*",
                    Authorization: undefined
                  },
                  responseType: "text",
                  transformResponse: [(data) => (typeof data === "string" ? data : String(data))]
                });
                if (typeof rawRes.data === "string" && rawRes.data.length > 0) {
                  file.content = rawRes.data;
                  file.truncated = false;
                }
              } catch {
                // If fetching full raw content fails, fall back to existing file.content
              }
            })
          );
        }
      }

      return gist;
    } catch (err: unknown) {
      throw new Error(await formatApiError(err, `Failed to fetch Gist ${id}`));
    }
  }
}
