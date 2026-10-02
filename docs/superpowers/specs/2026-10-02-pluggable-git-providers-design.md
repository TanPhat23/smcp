# Pluggable Git Providers Specification (GitHub, GitLab, Gitea) & Extensibility

**Date:** 2026-10-02  
**Status:** Approved  
**Author:** AI Coordinator & Developer  

---

## 1. Overview & Goals

Currently, remote pack inspection, installation, and sharing in `smcp` are tightly coupled to GitHub:
- `packages/core/src/core/github.ts` is a 942-line monolithic module combining GitHub Gist API, GitHub Git Data API, authentication, error parsers, and axios configuration.
- Pack loaders and share providers hardcode GitHub URL schemes (`github.com`, `gist.github.com`).
- Teams using **GitLab** (`gitlab.com` or self-hosted) or **Gitea / Forgejo** (`codeberg.org` or internal servers) cannot natively load or share packs.

### Goals
1. **Pluggable Git Architecture:** Establish a unified `GitProvider` interface and registry in `packages/core/src/core/git-providers/` supporting **GitHub**, **GitLab**, and **Gitea**.
2. **Refactor Monolithic `github.ts`:** Decompose the 942-line `github.ts` into single-responsibility submodules (`client.ts`, `gist.ts`, `repo.ts`, `errors.ts`, `types.ts`) with 100% backward compatibility for existing imports.
3. **Keep Core Lean (No S3 Bloat):** Do not bundle heavy S3 SDKs in core. Ensure `registerPackLoader` and `registerShareProvider` extension interfaces are clean, robust, and documented with an example plugin so users and enterprises can implement S3, MinIO, or Cloudflare R2 plugins via `~/.smcp/plugins/`.
4. **Preserve Zero Regressions:** Ensure all 758 existing tests continue passing without modification.

---

## 2. Pluggable Git Provider Architecture

### Directory Structure
```
packages/core/src/core/git-providers/
├── types.ts          # GitProvider, GitRepoRef, GitCommitParams, SnippetPackResult, GitFetchOptions
├── registry.ts       # registerGitProvider, resolveGitProviderForSource, getAllGitProviders
├── github/           # Modular GitHub implementation (refactored from monolithic github.ts)
│   ├── client.ts     # Axios instance & error handling
│   ├── gist.ts       # Gist fetch, create, update, caching
│   ├── repo.ts       # Repo pack fetch, tree commit, blob fetch
│   └── index.ts      # Provider definition + backward-compatible exports
├── gitlab/           # GitLab implementation (gitlab.com & self-hosted)
│   ├── client.ts     # GitLab v4 REST API client
│   ├── snippet.ts    # GitLab Snippets (multi-file Gist equivalent)
│   ├── repo.ts       # GitLab Repository Files & Commits API
│   └── index.ts      # GitLab provider definition
├── gitea/            # Gitea / Forgejo implementation (codeberg.org & self-hosted)
│   ├── client.ts     # Gitea v1 API client
│   ├── repo.ts       # Gitea Repo Trees & Files
│   └── index.ts      # Gitea provider definition
└── index.ts          # Public exports & auto-registration
```

---

## 3. Interfaces & Contracts

### 3.1 Git Reference Model (`git-providers/types.ts`)
```typescript
export interface GitRepoRef {
  provider: "github" | "gitlab" | "gitea";
  host: string;            // e.g. "github.com", "gitlab.com", "codeberg.org", "git.corp.internal"
  owner: string;           // user, group, or namespace
  repo: string;            // project or repository name
  ref?: string;            // branch, tag, or commit SHA (defaults to default branch)
  subpath?: string;        // subfolder inside repository containing smcp.json
}

export interface GitSnippetRef {
  provider: "github" | "gitlab" | "gitea";
  host: string;
  snippetId: string;
}
```

### 3.2 GitProvider Contract
```typescript
export interface GitProvider {
  readonly id: "github" | "gitlab" | "gitea";
  readonly name: string;
  readonly defaultHost: string;

  // Pattern detection & parsing
  matchesRepo(source: string): boolean;
  parseRepo(source: string): GitRepoRef | null;

  matchesSnippet?(source: string): boolean;
  parseSnippet(source: string): GitSnippetRef | null;

  // Remote pack operations (Read)
  fetchRepoPack(ref: GitRepoRef, options?: GitFetchOptions): Promise<RepoPackResult>;
  fetchSnippetPack?(ref: GitSnippetRef, options?: GitFetchOptions): Promise<SnippetPackResult>;

  // Remote pack operations (Write / Publish)
  commitFilesToRepo?(params: GitCommitParams): Promise<GitCommitResult>;
  publishSnippet?(params: GitPublishSnippetParams): Promise<GitSnippetResult>;

  // Authentication & Verification
  verifyUser(token: string, host?: string): Promise<AuthUser>;
}
```

---

## 4. Supported URL & Shorthand Syntax

### 4.1 GitLab
- **Shorthand:** `gitlab:my-group/my-pack`, `gitlab:my-group/subgroup/project#v1.2.0`
- **HTTPS URL:** `https://gitlab.com/my-group/my-pack`, `https://gitlab.com/my-group/my-pack/-/tree/main/subfolder`
- **Self-Hosted:** `https://git.company.internal/agents/workflow-pack`
- **Snippets:** `https://gitlab.com/-/snippets/3829102`

### 4.2 Gitea / Forgejo
- **Shorthand:** `gitea:owner/repo`, `codeberg:owner/repo`
- **HTTPS URL:** `https://codeberg.org/owner/repo`, `https://gitea.local/owner/repo`

### 4.3 GitHub (Existing & Preserved)
- `github:owner/repo[#ref]`, `owner/repo`, `https://github.com/owner/repo`, `https://gist.github.com/owner/id`

---

## 5. Non-Git Extensibility (S3, MinIO, Object Storage)

Instead of bundling AWS SDKs in core, `smcp` provides the documented extension pattern in `examples/plugins/s3-storage.js`:

```javascript
import { registerPackLoader, registerShareProvider } from "smcp";

// Users or companies drop this into ~/.smcp/plugins/s3-storage.js:
registerPackLoader({
  name: "s3",
  matches: (ctx) => ctx.source.startsWith("s3://"),
  load: async (ctx) => {
    // Custom S3 download using company-approved S3 client or MinIO
    return { manifest, rawFiles };
  }
});

registerShareProvider({
  id: "s3",
  label: "AWS S3 / MinIO Bucket",
  publish: async (ctx) => {
    // Custom S3 upload logic
    return true;
  }
});
```

---

## 6. Backward Compatibility Guarantee

1. `packages/core/src/core/github.ts` will re-export:
   - `GitHubClient`
   - `parseGitHubRepo`, `isRepoSource`, `generatePackReadme`
   - `parseGistId`, `createGitHubAxios`, `formatApiError`
   - All interfaces (`GitHubRepoRef`, `RepoPackResult`, `GistResponse`, `GitHubGistFile`)
2. Existing test files and scripts importing from `@tanphat/smcp-core` or `./github.ts` require zero changes.

---

## 7. Verification & Acceptance Criteria

1. **Unit Tests:**
   - `tests/git-providers-github.test.ts`: GitHub modular implementation.
   - `tests/git-providers-gitlab.test.ts`: GitLab URL parsing, repo pack loading, snippet loading.
   - `tests/git-providers-gitea.test.ts`: Gitea URL parsing, repo pack loading.
   - `tests/plugin-s3-extension.test.ts`: Verification of custom S3 pack loader and share provider plugin.
2. **Full Regression:**
   - Monorepo test suite passes 100% (758+ tests, 0 failures).
3. **Build:**
   - `bun run build` succeeds cleanly for both `@tanphat/smcp-core` and `@tanphat/smcp`.
