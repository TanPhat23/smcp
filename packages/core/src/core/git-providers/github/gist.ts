import type { AxiosInstance } from "axios";
import { formatApiError } from "./errors.ts";
import {
  createGitHubAxios,
  DEFAULT_TIMEOUT_MS
} from "./client.ts";
import {
  readGistCache,
  writeGistCache,
  touchGistCache,
  DEFAULT_GIST_CACHE_TTL_MS,
  type CacheEntry
} from "../../cache/index.ts";
import type {
  CreateGistPayload,
  GistResponse,
  GitHubClientOptions
} from "./types.ts";

export function parseGistId(gistIdOrUrl: string): string {
  if (!gistIdOrUrl || typeof gistIdOrUrl !== "string" || gistIdOrUrl.trim().length === 0) {
    throw new Error("Invalid Gist ID or URL provided");
  }

  let trimmed = gistIdOrUrl.trim();
  if (trimmed.startsWith("gist:")) {
    trimmed = trimmed.slice(5).trim();
  }

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

export function extractEtag(headers: unknown): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const h = headers as Record<string, unknown>;
  const etagVal =
    (typeof (h as any).get === "function" ? (h as any).get("etag") : undefined) ??
    h["etag"] ??
    h["ETag"] ??
    h["Etag"];
  return typeof etagVal === "string" ? etagVal : undefined;
}

export async function fetchRawFileContent(
  client: AxiosInstance,
  rawUrl: string
): Promise<string | null> {
  try {
    const rawRes = await client.get<string>(rawUrl, {
      headers: {
        Accept: "text/plain, */*",
        Authorization: undefined
      },
      responseType: "text",
      transformResponse: [(data) => (typeof data === "string" ? data : String(data))]
    });
    if (typeof rawRes.data === "string" && rawRes.data.length > 0) {
      return rawRes.data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveTruncatedFiles(
  client: AxiosInstance,
  gist: GistResponse,
  fetchAllTruncated?: boolean
): Promise<void> {
  if (!gist || !gist.files) return;

  const smcpFile = gist.files["smcp.json"];
  if (smcpFile && (smcpFile.truncated || !smcpFile.content) && smcpFile.raw_url) {
    const content = await fetchRawFileContent(client, smcpFile.raw_url);
    if (content !== null) {
      smcpFile.content = content;
      smcpFile.truncated = false;
    }
  }

  if (fetchAllTruncated) {
    const otherTruncatedFiles = Object.entries(gist.files)
      .filter(
        ([filename, file]) =>
          filename !== "smcp.json" && (file.truncated || !file.content) && Boolean(file.raw_url)
      )
      .map(([, file]) => file);

    if (otherTruncatedFiles.length > 0) {
      await Promise.all(
        otherTruncatedFiles.map(async (file) => {
          const content = await fetchRawFileContent(client, file.raw_url!);
          if (content !== null) {
            file.content = content;
            file.truncated = false;
          }
        })
      );
    }
  }
}

export async function fetchGist(
  gistIdOrUrl: string,
  token?: string,
  options?: GitHubClientOptions | number
): Promise<GistResponse> {
  const id = parseGistId(gistIdOrUrl);
  const clientOptions: GitHubClientOptions =
    typeof options === "number" ? { timeoutMs: options } : options || {};
  const client = clientOptions.axiosInstance || createGitHubAxios(token, clientOptions);

  const ttl = clientOptions.cacheTtlMs ?? DEFAULT_GIST_CACHE_TTL_MS;

  let cached: CacheEntry<GistResponse> | null = null;
  if (clientOptions.noCache !== true) {
    cached = readGistCache(id);
    if (cached) {
      const isFresh =
        clientOptions.cacheTtlMs !== undefined
          ? Date.now() - cached.cachedAt < clientOptions.cacheTtlMs
          : Date.now() - cached.cachedAt < DEFAULT_GIST_CACHE_TTL_MS;

      if (isFresh) {
        if (clientOptions.fetchAllTruncated) {
          await resolveTruncatedFiles(client, cached.data, true);
          writeGistCache(id, cached.data, cached.etag);
        }
        return cached.data;
      }
    }
  }

  try {
    const reqHeaders: Record<string, string> = {};
    const isConditional = Boolean(clientOptions.noCache !== true && cached?.etag);
    if (isConditional) {
      reqHeaders["If-None-Match"] = cached!.etag!;
    }

    const res = await client.get<GistResponse>(`/gists/${encodeURIComponent(id)}`, {
      headers: isConditional ? reqHeaders : undefined,
      validateStatus: isConditional
        ? (s) => (s >= 200 && s < 300) || s === 304
        : undefined
    });

    if (res.status === 304 && cached) {
      const newEtag = extractEtag(res.headers);
      if (clientOptions.fetchAllTruncated) {
        await resolveTruncatedFiles(client, cached.data, true);
      }
      if (newEtag) {
        writeGistCache(id, cached.data, newEtag);
      } else if (clientOptions.fetchAllTruncated) {
        writeGistCache(id, cached.data, cached.etag);
      } else {
        touchGistCache(id);
      }
      return cached.data;
    }

    const gist = res.data;

    // Handle truncated files
    await resolveTruncatedFiles(client, gist, clientOptions.fetchAllTruncated);

    const etag = extractEtag(res.headers);
    writeGistCache(id, gist, etag);

    return gist;
  } catch (err: unknown) {
    throw new Error(await formatApiError(err, `Failed to fetch Gist ${id}`));
  }
}

export async function createGist(
  payload: CreateGistPayload,
  tokenOrClient?: string | AxiosInstance,
  options?: GitHubClientOptions | number
): Promise<{ id: string; html_url: string; [key: string]: unknown }> {
  let client: AxiosInstance;
  if (tokenOrClient && typeof (tokenOrClient as AxiosInstance).post === "function") {
    client = tokenOrClient as AxiosInstance;
  } else {
    const token = typeof tokenOrClient === "string" ? tokenOrClient : undefined;
    client = createGitHubAxios(token, options);
  }

  try {
    const res = await client.post<{ id: string; html_url: string }>("/gists", payload);
    return res.data;
  } catch (err: unknown) {
    throw new Error(await formatApiError(err, "Failed to create Gist"));
  }
}

export async function updateGist(
  gistId: string,
  payload: Partial<CreateGistPayload>,
  tokenOrClient?: string | AxiosInstance,
  options?: GitHubClientOptions | number
): Promise<{ id: string; html_url: string; [key: string]: unknown }> {
  let client: AxiosInstance;
  if (tokenOrClient && typeof (tokenOrClient as AxiosInstance).patch === "function") {
    client = tokenOrClient as AxiosInstance;
  } else {
    const token = typeof tokenOrClient === "string" ? tokenOrClient : undefined;
    client = createGitHubAxios(token, options);
  }

  try {
    const res = await client.patch<{ id: string; html_url: string }>(
      `/gists/${encodeURIComponent(gistId)}`,
      payload
    );
    return res.data;
  } catch (err: unknown) {
    throw new Error(await formatApiError(err, `Failed to update Gist ${gistId}`));
  }
}
