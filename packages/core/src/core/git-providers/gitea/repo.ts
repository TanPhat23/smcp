import { isAxiosError, type AxiosInstance } from "axios";
import { ManifestSchema } from "../../../types/index.ts";
import { createGiteaAxios, formatGiteaApiError } from "./client.ts";
import type {
  GitRepoRef,
  RepoPackResult,
  GitFetchOptions,
  GiteaClientOptions,
  GiteaRepoResponse,
  GiteaTreeResponse
} from "./types.ts";

function isGiteaHost(hostname: string, customHosts?: string[]): boolean {
  const lower = hostname.toLowerCase();
  if (customHosts && customHosts.some((h) => h.toLowerCase() === lower)) {
    return true;
  }
  return (
    lower === "gitea.com" ||
    lower.endsWith(".gitea.com") ||
    lower.includes("gitea") ||
    lower === "codeberg.org" ||
    lower.endsWith(".codeberg.org") ||
    lower.includes("codeberg") ||
    lower.includes("forgejo")
  );
}

export function parseGiteaRepo(input: string, customHosts?: string[]): GitRepoRef | null {
  if (!input || typeof input !== "string" || input.trim().length === 0) {
    return null;
  }
  const trimmed = input.trim();

  // 1. gitea: or codeberg: shorthand
  if (trimmed.startsWith("gitea:") || trimmed.startsWith("codeberg:")) {
    const isCodeberg = trimmed.startsWith("codeberg:");
    const prefixLen = isCodeberg ? 9 : 6;
    const defaultHost = isCodeberg ? "codeberg.org" : "gitea.com";

    const rest = trimmed.slice(prefixLen).replace(/^\/+/, "");
    const [pathPart, hashPart] = rest.split("#");
    if (!pathPart) return null;

    let host = defaultHost;
    let actualPath = pathPart;
    let ref = hashPart || undefined;
    let subpath: string | undefined = undefined;

    const treeMatch = actualPath.match(
      /^(.*?)\/(?:src|raw)\/(?:(?:branch|tag|commit)\/)?([^/]+)(?:\/(.*))?$/
    );
    if (treeMatch) {
      actualPath = treeMatch[1];
      ref = treeMatch[2];
      subpath = treeMatch[3] || undefined;
    }

    const segments = actualPath.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    if (segments[0].includes(".") && segments.length >= 3) {
      host = segments[0];
      segments.shift();
    }

    const repo = segments[segments.length - 1].replace(/\.git$/, "");
    const owner = segments.slice(0, -1).join("/");

    return {
      provider: "gitea",
      host,
      owner,
      repo,
      ref,
      subpath
    };
  }

  // 2. HTTPS / HTTP URLs
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      if (!isGiteaHost(u.hostname, customHosts)) {
        return null;
      }

      let pathname = u.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
      if (pathname.endsWith(".git")) {
        pathname = pathname.slice(0, -4);
      }

      let ref: string | undefined = u.hash ? u.hash.slice(1) : undefined;
      let subpath: string | undefined = undefined;

      const treeMatch = pathname.match(
        /^(.*?)\/(?:src|raw)\/(?:(?:branch|tag|commit)\/)?([^/]+)(?:\/(.*))?$/
      );
      let repoPath = pathname;
      if (treeMatch) {
        repoPath = treeMatch[1];
        ref = treeMatch[2];
        subpath = treeMatch[3] || undefined;
      }

      const segments = repoPath.split("/").filter(Boolean);
      if (segments.length < 2) {
        return null;
      }

      const repo = segments[segments.length - 1];
      const owner = segments.slice(0, -1).join("/");

      return {
        provider: "gitea",
        host: u.hostname,
        owner,
        repo,
        ref,
        subpath
      };
    } catch {
      return null;
    }
  }

  return null;
}

export function isGiteaRepoSource(input: string, customHosts?: string[]): boolean {
  return parseGiteaRepo(input, customHosts) !== null;
}

export async function fetchGiteaRepoPack(
  source: string | GitRepoRef,
  token?: string,
  options?: GitFetchOptions | GiteaClientOptions | number
): Promise<RepoPackResult> {
  let repoRef: GitRepoRef | null;
  if (typeof source === "string") {
    repoRef = parseGiteaRepo(source);
    if (!repoRef) {
      throw new Error(`Invalid Gitea repository source: ${source}`);
    }
  } else {
    repoRef = source;
  }

  const { host, owner, repo, subpath } = repoRef;
  const repoFullName = `${owner}/${repo}`;

  const clientOptions: GiteaClientOptions =
    typeof options === "number"
      ? { timeoutMs: options }
      : options
      ? {
          ...options,
          baseURL:
            ("baseURL" in options && typeof options.baseURL === "string")
              ? options.baseURL
              : `https://${host}/api/v1`
        }
      : { baseURL: `https://${host}/api/v1` };

  const client = clientOptions.axiosInstance || createGiteaAxios(token, clientOptions);

  try {
    let ref = repoRef.ref;
    if (!ref) {
      const repoRes = await client.get<GiteaRepoResponse>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
      );
      ref = repoRes.data.default_branch || "main";
    }

    const treeRes = await client.get<GiteaTreeResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}`,
      {
        params: { recursive: 1 }
      }
    );

    const tree = treeRes.data?.tree || [];
    const manifestPath = subpath ? `${subpath}/smcp.json` : "smcp.json";
    const manifestItem = tree.find((item) => item.path === manifestPath && item.type === "blob");

    if (!manifestItem) {
      throw new Error(
        `Repository ${repoFullName} does not contain an smcp.json manifest file at ${manifestPath}.`
      );
    }

    const fetchFileContent = async (filePath: string, blobSha?: string): Promise<string> => {
      // 1. Try raw endpoint
      try {
        const rawRes = await client.get<string>(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${filePath}`,
          {
            params: { ref },
            responseType: "text",
            transformResponse: [(data) => (typeof data === "string" ? data : String(data))]
          }
        );
        if (rawRes.data !== undefined && rawRes.data !== null) {
          return typeof rawRes.data === "string" ? rawRes.data : JSON.stringify(rawRes.data);
        }
      } catch {
        // Fallback to git blob if available
      }

      // 2. Try git blob endpoint
      if (blobSha) {
        try {
          const blobRes = await client.get<{ content: string; encoding: string }>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(blobSha)}`
          );
          if (blobRes.data?.encoding === "base64" && blobRes.data.content) {
            return Buffer.from(blobRes.data.content, "base64").toString("utf8");
          }
          if (typeof blobRes.data?.content === "string") {
            return blobRes.data.content;
          }
        } catch {
          // Fallback to contents endpoint
        }
      }

      // 3. Fallback to /contents/{filePath}
      const contentRes = await client.get<{ content?: string; encoding?: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`,
        { params: { ref } }
      );
      if (contentRes.data?.content) {
        if (contentRes.data.encoding === "base64") {
          return Buffer.from(contentRes.data.content, "base64").toString("utf8");
        }
        return contentRes.data.content;
      }

      throw new Error(`Failed to retrieve content for ${filePath}`);
    };

    const manifestContent = await fetchFileContent(manifestItem.path, manifestItem.sha);
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
          const content = await fetchFileContent(blob.path, blob.sha);
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
      repoFullName,
      ref,
      htmlUrl: `https://${host}/${repoFullName}`
    };
  } catch (err: unknown) {
    throw new Error(formatGiteaApiError(err, `Failed to load Gitea repository pack ${repoFullName}`));
  }
}

export async function commitGiteaFiles(params: {
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
  const host = params.host || "gitea.com";
  let client = params.client;
  if (!client) {
    const baseURL = `https://${host}/api/v1`;
    client = createGiteaAxios(token, { baseURL });
  }

  // 1. Check if repo exists, create if not
  let repoData: GiteaRepoResponse | null = null;
  try {
    const res = await client.get<GiteaRepoResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    );
    repoData = res.data;
  } catch (err: unknown) {
    if (isAxiosError(err) && err.response?.status === 404) {
      const createRes = await client.post<GiteaRepoResponse>("/user/repos", {
        name: repo,
        description,
        private: !isPublic,
        auto_init: true
      });
      repoData = createRes.data;
    } else {
      throw new Error(formatGiteaApiError(err, `Failed to get Gitea repository ${owner}/${repo}`));
    }
  }

  const branch = params.branch || repoData.default_branch || "main";

  // 2. Base commit / tree SHA
  let baseCommitSha: string | undefined;
  let baseTreeSha: string | undefined;

  try {
    const refRes = await client.get<{ object: { sha: string } }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`
    );
    baseCommitSha = refRes.data.object.sha;
    const commitRes = await client.get<{ tree: { sha: string } }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(baseCommitSha)}`
    );
    baseTreeSha = commitRes.data.tree.sha;
  } catch {
    // Branch may be new or empty
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

  try {
    const treeRes = await client.post<{ sha: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
      treePayload
    );
    const newTreeSha = treeRes.data.sha;

    // 4. Create commit
    const commitPayload = {
      message,
      tree: newTreeSha,
      parents: baseCommitSha ? [baseCommitSha] : []
    };
    const newCommitRes = await client.post<{ sha: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
      commitPayload
    );
    const newCommitSha = newCommitRes.data.sha;

    // 5. Update or create branch ref
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
      html_url: repoData.html_url || `https://${host}/${owner}/${repo}`,
      branch
    };
  } catch (err: unknown) {
    throw new Error(formatGiteaApiError(err, `Failed to commit files to Gitea repository ${owner}/${repo}`));
  }
}
