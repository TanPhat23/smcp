import fs from "node:fs";
import { type AxiosInstance, isAxiosError } from "axios";
import { ManifestSchema, type Manifest } from "../../../types/index.ts";
import { formatApiError } from "./errors.ts";
import { createGitHubAxios } from "./client.ts";
import type {
  GitHubClientOptions,
  GitHubRepoRef,
  RepoPackResult,
  GitRepoRef
} from "./types.ts";

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

export async function fetchRepoFileContent(
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

export async function getRepository(
  owner: string,
  repo: string,
  tokenOrClient?: string | AxiosInstance,
  options?: GitHubClientOptions | number
): Promise<{ id: number; name: string; full_name: string; html_url: string; default_branch: string } | null> {
  let client: AxiosInstance;
  if (tokenOrClient && typeof (tokenOrClient as AxiosInstance).get === "function") {
    client = tokenOrClient as AxiosInstance;
  } else {
    const token = typeof tokenOrClient === "string" ? tokenOrClient : undefined;
    client = createGitHubAxios(token, options);
  }

  try {
    const res = await client.get<{
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

export async function createRepository(
  payload: {
    name: string;
    description?: string;
    private?: boolean;
    org?: string;
    auto_init?: boolean;
  },
  tokenOrClient?: string | AxiosInstance,
  options?: GitHubClientOptions | number
): Promise<{ id: number; name: string; full_name: string; html_url: string; default_branch: string }> {
  let client: AxiosInstance;
  if (tokenOrClient && typeof (tokenOrClient as AxiosInstance).post === "function") {
    client = tokenOrClient as AxiosInstance;
  } else {
    const token = typeof tokenOrClient === "string" ? tokenOrClient : undefined;
    client = createGitHubAxios(token, options);
  }

  try {
    const endpoint = payload.org
      ? `/orgs/${encodeURIComponent(payload.org)}/repos`
      : "/user/repos";
    const res = await client.post<{
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

export async function commitFilesToRepo(params: {
  owner: string;
  repo: string;
  branch?: string;
  message: string;
  files: Record<string, string>;
  isPublic?: boolean;
  description?: string;
  token?: string;
  client?: AxiosInstance;
  host?: string;
}): Promise<{ commitSha: string; html_url: string; branch: string }> {
  const { owner, repo, message, files, isPublic = true, description = "", token } = params;
  let client = params.client;
  if (!client) {
    const baseURL = params.host && params.host !== "github.com" ? `https://${params.host}/api/v3` : undefined;
    client = createGitHubAxios(token, baseURL ? { baseURL } : undefined);
  }

  let branch = params.branch;

  // 1. Check if repo exists, create if not
  let repoData = await getRepository(owner, repo, client);
  if (!repoData) {
    repoData = await createRepository(
      {
        name: repo,
        description,
        private: !isPublic,
        auto_init: true
      },
      client
    );
  }

  if (!branch) {
    branch = repoData.default_branch || "main";
  }

  // 2. Get latest commit SHA on target branch
  let baseCommitSha: string | undefined;
  let baseTreeSha: string | undefined;

  try {
    const refRes = await client.get<{ object: { sha: string } }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`
    );
    baseCommitSha = refRes.data.object.sha;
    const commitRes = await client.get<{ tree: { sha: string } }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(baseCommitSha)}`
    );
    baseTreeSha = commitRes.data.tree.sha;
  } catch {
    // Branch might not exist yet; try default branch if different
    if (branch !== repoData.default_branch) {
      try {
        const defaultRefRes = await client.get<{ object: { sha: string } }>(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(repoData.default_branch)}`
        );
        baseCommitSha = defaultRefRes.data.object.sha;
        const commitRes = await client.get<{ tree: { sha: string } }>(
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

  const treeRes = await client.post<{ sha: string }>(
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
  const newCommitRes = await client.post<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    commitPayload
  );
  const newCommitSha = newCommitRes.data.sha;

  // 5. Update or create branch reference
  if (baseCommitSha) {
    await client.patch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
      { sha: newCommitSha, force: false }
    );
  } else {
    await client.post(
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

export async function fetchRepoPack(
  source: string | GitRepoRef | GitHubRepoRef,
  token?: string,
  options?: GitHubClientOptions | number
): Promise<RepoPackResult> {
  let repoRef: GitHubRepoRef | null;
  if (typeof source === "string") {
    repoRef = parseGitHubRepo(source);
    if (!repoRef) {
      throw new Error(`Invalid GitHub repository source: ${source}`);
    }
  } else {
    repoRef = source;
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

    const manifestContent = await fetchRepoFileContent(
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
      if (prefix && !item.path.startsWith(prefix)) {
        return false;
      }
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
          const content = await fetchRepoFileContent(
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
