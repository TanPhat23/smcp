import { ManifestSchema } from "../../../types/index.ts";
import { createGitLabAxios, formatGitLabApiError } from "./client.ts";
import type {
  GitSnippetRef,
  GitSnippetResult,
  SnippetPackResult,
  GitFetchOptions,
  GitPublishSnippetParams,
  GitLabSnippetResponse,
  GitLabClientOptions
} from "./types.ts";

export function parseGitLabSnippet(input: string): GitSnippetRef | null {
  if (!input || typeof input !== "string" || input.trim().length === 0) {
    return null;
  }
  const trimmed = input.trim();

  // 1. gitlab-snippet:123 or gitlab:snippet/123
  if (trimmed.startsWith("gitlab-snippet:")) {
    const id = trimmed.slice("gitlab-snippet:".length).trim();
    if (/^\d+$/.test(id)) {
      return {
        provider: "gitlab",
        host: "gitlab.com",
        snippetId: id
      };
    }
  }

  if (trimmed.startsWith("gitlab:snippet/")) {
    const id = trimmed.slice("gitlab:snippet/".length).trim();
    if (/^\d+$/.test(id)) {
      return {
        provider: "gitlab",
        host: "gitlab.com",
        snippetId: id
      };
    }
  }

  // 2. HTTPS / HTTP URLs
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      const isGitLabHost =
        u.hostname === "gitlab.com" ||
        u.hostname === "www.gitlab.com" ||
        u.hostname.includes("gitlab");

      if (!isGitLabHost) {
        return null;
      }

      const match = u.pathname.match(/(?:^|\/)(?:-)?\/snippets\/(\d+)(?:\/|$)/);
      if (match) {
        return {
          provider: "gitlab",
          host: u.hostname,
          snippetId: match[1]
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function fetchGitLabSnippetPack(
  refOrSource: string | GitSnippetRef,
  token?: string,
  options?: GitFetchOptions | GitLabClientOptions | number
): Promise<SnippetPackResult> {
  let snippetRef: GitSnippetRef | null;
  if (typeof refOrSource === "string") {
    snippetRef = parseGitLabSnippet(refOrSource);
    if (!snippetRef) {
      throw new Error(`Invalid GitLab snippet source: ${refOrSource}`);
    }
  } else {
    snippetRef = refOrSource;
  }

  const { host, snippetId } = snippetRef;
  const clientOptions: GitLabClientOptions =
    typeof options === "number"
      ? { timeoutMs: options }
      : options
      ? { ...options, baseURL: host !== "gitlab.com" ? `https://${host}/api/v4` : undefined }
      : { baseURL: host !== "gitlab.com" ? `https://${host}/api/v4` : undefined };

  const client = clientOptions.axiosInstance || createGitLabAxios(token, clientOptions);

  try {
    const res = await client.get<GitLabSnippetResponse>(`/snippets/${encodeURIComponent(snippetId)}`);
    const snippet = res.data;
    const rawFiles: Record<string, string> = {};

    if (Array.isArray(snippet.files) && snippet.files.length > 0) {
      await Promise.all(
        snippet.files.map(async (f) => {
          try {
            const rawRes = await client.get<string>(f.raw_url, {
              responseType: "text",
              transformResponse: [(data) => (typeof data === "string" ? data : String(data))]
            });
            rawFiles[f.path] = rawRes.data;
          } catch {
            const fallbackRes = await client.get<string>(
              `/snippets/${encodeURIComponent(snippetId)}/files/main/${encodeURIComponent(f.path)}/raw`,
              {
                responseType: "text",
                transformResponse: [(data) => (typeof data === "string" ? data : String(data))]
              }
            );
            rawFiles[f.path] = fallbackRes.data;
          }
        })
      );
    } else if (snippet.raw_url) {
      const rawRes = await client.get<string>(snippet.raw_url, {
        responseType: "text",
        transformResponse: [(data) => (typeof data === "string" ? data : String(data))]
      });
      rawFiles[snippet.file_name || "smcp.json"] = rawRes.data;
    } else if (snippet.content) {
      rawFiles[snippet.file_name || "smcp.json"] = snippet.content;
    }

    if (!rawFiles["smcp.json"]) {
      throw new Error(`GitLab snippet ${snippetId} does not contain an smcp.json manifest file.`);
    }

    const manifest = ManifestSchema.parse(JSON.parse(rawFiles["smcp.json"]));

    return {
      manifest,
      rawFiles,
      snippetId: String(snippet.id),
      htmlUrl: snippet.web_url || `https://${host}/-/snippets/${snippetId}`
    };
  } catch (err: unknown) {
    throw new Error(formatGitLabApiError(err, `Failed to load GitLab snippet ${snippetId}`));
  }
}

export async function publishGitLabSnippet(
  params: GitPublishSnippetParams
): Promise<GitSnippetResult> {
  const host = params.host || "gitlab.com";
  const client = createGitLabAxios(
    params.token,
    host !== "gitlab.com" ? { baseURL: `https://${host}/api/v4` } : undefined
  );

  const snippetFiles = Object.entries(params.files).map(([filePath, content]) => ({
    file_path: filePath.replaceAll("\\", "/"),
    content
  }));

  try {
    const res = await client.post<{ id: number; web_url: string }>("/snippets", {
      title: params.title || params.description || "smcp-pack",
      description: params.description || "",
      visibility: params.isPublic ? "public" : "private",
      files: snippetFiles
    });

    return {
      snippetId: String(res.data.id),
      htmlUrl: res.data.web_url
    };
  } catch (err: unknown) {
    throw new Error(formatGitLabApiError(err, "Failed to publish GitLab snippet"));
  }
}
