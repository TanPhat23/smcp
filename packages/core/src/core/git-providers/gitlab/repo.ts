import { isAxiosError, type AxiosInstance } from "axios";
import { ManifestSchema } from "../../../types/index.ts";
import { createGitLabAxios, formatGitLabApiError } from "./client.ts";
import type {
  GitRepoRef,
  RepoPackResult,
  GitFetchOptions,
  GitLabClientOptions,
  GitLabProjectResponse,
  GitLabTreeItem
} from "./types.ts";

export function parseGitLabRepo(input: string): GitRepoRef | null {
  if (!input || typeof input !== "string" || input.trim().length === 0) {
    return null;
  }
  const trimmed = input.trim();

  // Exclude snippet URLs and shorthands
  if (
    trimmed.includes("/-/snippets/") ||
    trimmed.includes("/snippets/") ||
    trimmed.startsWith("gitlab-snippet:") ||
    trimmed.startsWith("gitlab:snippet/")
  ) {
    return null;
  }

  // 1. gitlab: shorthand
  if (trimmed.startsWith("gitlab:")) {
    const rest = trimmed.slice(7).replace(/^\/+/, "");
    const [pathPart, hashPart] = rest.split("#");
    if (!pathPart) return null;

    let host = "gitlab.com";
    let actualPath = pathPart;
    let ref = hashPart || undefined;
    let subpath: string | undefined = undefined;

    const treeMatch = actualPath.match(/^(.*?)\/-\/(?:tree|blob|raw)\/([^/]+)(?:\/(.*))?$/);
    if (treeMatch) {
      actualPath = treeMatch[1];
      ref = treeMatch[2];
      subpath = treeMatch[3] || undefined;
    }

    const segments = actualPath.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    // Check if first segment is a domain (e.g. gitlab.example.corp/group/project)
    if (segments[0].includes(".") && segments.length >= 3) {
      host = segments[0];
      segments.shift();
    }

    const repo = segments[segments.length - 1].replace(/\.git$/, "");
    const owner = segments.slice(0, -1).join("/");

    return {
      provider: "gitlab",
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
      const isGitLabHost =
        u.hostname === "gitlab.com" ||
        u.hostname === "www.gitlab.com" ||
        u.hostname.includes("gitlab");

      if (!isGitLabHost) {
        return null;
      }

      let pathname = u.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
      if (pathname.endsWith(".git")) {
        pathname = pathname.slice(0, -4);
      }

      let ref: string | undefined = u.hash ? u.hash.slice(1) : undefined;
      let subpath: string | undefined = undefined;

      const treeMatch = pathname.match(/^(.*?)\/-\/(?:tree|blob|raw)\/([^/]+)(?:\/(.*))?$/);
      let projectPath = pathname;
      if (treeMatch) {
        projectPath = treeMatch[1];
        ref = treeMatch[2];
        subpath = treeMatch[3] || undefined;
      }

      const segments = projectPath.split("/").filter(Boolean);
      if (segments.length < 2) {
        return null;
      }

      const repo = segments[segments.length - 1];
      const owner = segments.slice(0, -1).join("/");

      return {
        provider: "gitlab",
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

export function isGitLabRepoSource(input: string): boolean {
  return parseGitLabRepo(input) !== null;
}

export async function fetchGitLabRepoPack(
  source: string | GitRepoRef,
  token?: string,
  options?: GitFetchOptions | GitLabClientOptions | number
): Promise<RepoPackResult> {
  let repoRef: GitRepoRef | null;
  if (typeof source === "string") {
    repoRef = parseGitLabRepo(source);
    if (!repoRef) {
      throw new Error(`Invalid GitLab repository source: ${source}`);
    }
  } else {
    repoRef = source;
  }

  const { host, owner, repo, subpath } = repoRef;
  const projectPath = `${owner}/${repo}`;
  const encodedPath = encodeURIComponent(projectPath);

  const clientOptions: GitLabClientOptions =
    typeof options === "number"
      ? { timeoutMs: options }
      : options
      ? { ...options, baseURL: host !== "gitlab.com" ? `https://${host}/api/v4` : undefined }
      : { baseURL: host !== "gitlab.com" ? `https://${host}/api/v4` : undefined };

  const client = clientOptions.axiosInstance || createGitLabAxios(token, clientOptions);

  try {
    let ref = repoRef.ref;
    if (!ref) {
      const projectRes = await client.get<GitLabProjectResponse>(`/projects/${encodedPath}`);
      ref = projectRes.data.default_branch || "main";
    }

    let page = 1;
    const tree: GitLabTreeItem[] = [];
    while (page > 0) {
      const treeRes = await client.get<GitLabTreeItem[]>(
        `/projects/${encodedPath}/repository/tree`,
        {
          params: {
            ref,
            recursive: true,
            per_page: 100,
            page
          }
        }
      );
      if (Array.isArray(treeRes.data)) {
        tree.push(...treeRes.data);
      }
      const nextPageHeader = treeRes.headers?.["x-next-page"];
      page =
        nextPageHeader && String(nextPageHeader).trim() !== ""
          ? parseInt(nextPageHeader, 10)
          : 0;
    }

    const manifestPath = subpath ? `${subpath}/smcp.json` : "smcp.json";
    const manifestItem = tree.find((item) => item.path === manifestPath && item.type === "blob");

    if (!manifestItem) {
      throw new Error(
        `Repository ${projectPath} does not contain an smcp.json manifest file at ${manifestPath}.`
      );
    }

    const fetchFileContent = async (filePath: string): Promise<string> => {
      const fileRes = await client.get<string>(
        `/projects/${encodedPath}/repository/files/${encodeURIComponent(filePath)}/raw`,
        {
          params: { ref },
          responseType: "text",
          transformResponse: [(data) => (typeof data === "string" ? data : String(data))]
        }
      );
      return fileRes.data;
    };

    const manifestContent = await fetchFileContent(manifestItem.path);
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
          const content = await fetchFileContent(blob.path);
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
      repoFullName: projectPath,
      ref,
      htmlUrl: `https://${host}/${projectPath}`
    };
  } catch (err: unknown) {
    throw new Error(formatGitLabApiError(err, `Failed to load GitLab repository pack ${projectPath}`));
  }
}

export async function commitGitLabFiles(params: {
  projectPath: string;
  branch?: string;
  message: string;
  files: Record<string, string>;
  isPublic?: boolean;
  description?: string;
  token?: string;
  client?: AxiosInstance;
  host?: string;
}): Promise<{ commitSha: string; html_url: string; branch: string }> {
  const { projectPath, message, files, isPublic = true, description = "", token } = params;
  const host = params.host || "gitlab.com";
  let client = params.client;
  if (!client) {
    const baseURL = host !== "gitlab.com" ? `https://${host}/api/v4` : undefined;
    client = createGitLabAxios(token, baseURL ? { baseURL } : undefined);
  }

  const encodedPath = encodeURIComponent(projectPath);

  // 1. Check if project exists, create if not
  let project: GitLabProjectResponse | null = null;
  try {
    const res = await client.get<GitLabProjectResponse>(`/projects/${encodedPath}`);
    project = res.data;
  } catch (err: unknown) {
    if (isAxiosError(err) && err.response?.status === 404) {
      const parts = projectPath.split("/");
      const repoName = parts[parts.length - 1];
      const namespace = parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;

      let namespaceId: number | undefined;
      if (namespace) {
        try {
          const groupRes = await client.get<{ id: number }>(`/groups/${encodeURIComponent(namespace)}`);
          namespaceId = groupRes.data.id;
        } catch {
          // Namespace might not be a group
        }
      }

      const createRes = await client.post<GitLabProjectResponse>("/projects", {
        name: repoName,
        description,
        visibility: isPublic ? "public" : "private",
        initialize_with_readme: true,
        ...(namespaceId ? { namespace_id: namespaceId } : {})
      });
      project = createRes.data;
    } else {
      throw new Error(formatGitLabApiError(err, `Failed to get project ${projectPath}`));
    }
  }

  const branch = params.branch || project.default_branch || "main";

  // 2. Fetch existing files in branch
  const existingFiles = new Set<string>();
  try {
    const treeRes = await client.get<GitLabTreeItem[]>(
      `/projects/${encodedPath}/repository/tree`,
      {
        params: { ref: branch, recursive: true, per_page: 100 }
      }
    );
    if (Array.isArray(treeRes.data)) {
      for (const item of treeRes.data) {
        if (item.type === "blob") {
          existingFiles.add(item.path);
        }
      }
    }
  } catch {
    // Branch may not exist or be empty
  }

  // 3. Build actions
  const actions = Object.entries(files).map(([filePath, content]) => {
    const normPath = filePath.replaceAll("\\", "/");
    const action = existingFiles.has(normPath) ? ("update" as const) : ("create" as const);
    return {
      action,
      file_path: normPath,
      content
    };
  });

  // 4. Post commit
  try {
    const commitRes = await client.post<{ id: string; web_url?: string }>(
      `/projects/${encodedPath}/repository/commits`,
      {
        branch,
        commit_message: message,
        actions
      }
    );

    return {
      commitSha: commitRes.data.id,
      html_url: project.web_url || `https://${host}/${projectPath}`,
      branch
    };
  } catch (err: unknown) {
    throw new Error(formatGitLabApiError(err, `Failed to commit files to GitLab project ${projectPath}`));
  }
}
