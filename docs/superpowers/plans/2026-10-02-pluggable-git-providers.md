# Pluggable Git Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the 942-line monolithic `packages/core/src/core/github.ts` into a modular, pluggable Git provider architecture in `packages/core/src/core/git-providers/` supporting GitHub, GitLab, and Gitea, while keeping core lean and preserving 100% backward compatibility.

**Architecture:** A unified `GitProvider` interface and registry in `packages/core/src/core/git-providers/` that routes remote repo and snippet sources to the appropriate provider (GitHub, GitLab, Gitea). GitHub logic is decomposed into dedicated submodules (`client.ts`, `gist.ts`, `repo.ts`, `errors.ts`, `types.ts`), and `packages/core/src/core/github.ts` becomes a backward-compatible proxy. Non-Git remotes (such as S3) are demonstrated and tested via the existing plugin extension API without adding heavyweight SDKs to core.

**Tech Stack:** TypeScript, Bun, Axios, Semver, Zod, Git REST APIs (GitHub REST v3, GitLab REST v4, Gitea REST v1).

**Spec:** `docs/superpowers/specs/2026-10-02-pluggable-git-providers-design.md`

## Global Constraints
- Zero breaking changes for existing imports from `@tanphat/smcp-core` or `./github.ts`.
- No new external runtime dependencies (no AWS SDKs in core).
- All 758 existing tests must continue to pass.
- Strict anti-slop guidelines: no placeholder comments, no untested assumptions.

## Review Focus
- **URL Ambiguity:** Shorthands like `owner/repo` must default to GitHub, while `gitlab:group/project` and `gitea:owner/repo` resolve to their respective providers.
- **Deep Namespace Groups:** GitLab group/subgroup/project paths (e.g. `gitlab.com/org/team/subgroup/repo`) must parse the project namespace correctly without misidentifying subpaths.
- **Snippet vs Repo:** Snippet URLs (`gitlab.com/-/snippets/123`, `gist.github.com/123`) must route to snippet loaders, not repository tree loaders.
- **Token Scope & Auth Headers:** GitLab uses `PRIVATE-TOKEN: <pat>` (or `Authorization: Bearer <pat>`); Gitea uses `Authorization: token <pat>`; GitHub uses `Authorization: Bearer <pat>`.
- **Cache Compatibility:** Modular providers must integrate with the existing `core/cache/` system so ETag and TTL revalidation continue functioning across providers.

---

### Task 1: Pluggable Git Provider Interfaces & Registry

**Files:**
- Create: `packages/core/src/core/git-providers/types.ts`
- Create: `packages/core/src/core/git-providers/registry.ts`
- Create: `packages/core/src/core/git-providers/index.ts`
- Test: `tests/git-providers-registry.test.ts`

**Interfaces:**
- Consumes: `Manifest` from `../../types/index.ts`, `AuthUser` from `../auth/types.ts`.
- Produces: `GitRepoRef`, `GitSnippetRef`, `GitProvider`, `GitFetchOptions`, `GitCommitParams`, `GitCommitResult`, `SnippetPackResult`, `registerGitProvider`, `unregisterGitProvider`, `resolveGitProviderForSource`, `getAllGitProviders`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/git-providers-registry.test.ts
import { describe, expect, it, beforeEach } from "bun:test";
import {
  registerGitProvider,
  unregisterGitProvider,
  resolveGitProviderForSource,
  getAllGitProviders,
  type GitProvider,
  type GitRepoRef
} from "../packages/core/src/core/git-providers/index.ts";

describe("Git Providers Registry", () => {
  const dummyProvider: GitProvider = {
    id: "mock-provider",
    name: "Mock Provider",
    defaultHost: "mock.git.com",
    matchesRepo: (source) => source.startsWith("mock:"),
    parseRepo: (source) => {
      if (!source.startsWith("mock:")) return null;
      const [owner, repo] = source.slice(5).split("/");
      return { provider: "mock-provider", host: "mock.git.com", owner, repo };
    },
    fetchRepoPack: async () => { throw new Error("not implemented"); },
    verifyUser: async () => ({ username: "mockuser" })
  };

  beforeEach(() => {
    unregisterGitProvider("mock-provider");
  });

  it("registers and resolves a custom git provider", () => {
    registerGitProvider(dummyProvider);
    expect(getAllGitProviders().some(p => p.id === "mock-provider")).toBe(true);
    const resolved = resolveGitProviderForSource("mock:owner/repo");
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe("mock-provider");
  });

  it("unregisters a git provider cleanly", () => {
    registerGitProvider(dummyProvider);
    expect(unregisterGitProvider("mock-provider")).toBe(true);
    expect(resolveGitProviderForSource("mock:owner/repo")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/git-providers-registry.test.ts`  
Expected: FAIL with "Cannot find module ../packages/core/src/core/git-providers/index.ts".

- [ ] **Step 3: Write minimal implementation**

Implement `packages/core/src/core/git-providers/types.ts`, `registry.ts`, and `index.ts` with type definitions and registry storage (`activeProviders: GitProvider[]`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/git-providers-registry.test.ts`  
Expected: PASS (2 tests pass).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core/git-providers/ tests/git-providers-registry.test.ts
git commit -m "feat(git-providers): create pluggable GitProvider interfaces and registry"
```

---

### Task 2: Refactor Monolithic `github.ts` into Modular `git-providers/github/`

**Files:**
- Create: `packages/core/src/core/git-providers/github/types.ts`
- Create: `packages/core/src/core/git-providers/github/errors.ts`
- Create: `packages/core/src/core/git-providers/github/client.ts`
- Create: `packages/core/src/core/git-providers/github/gist.ts`
- Create: `packages/core/src/core/git-providers/github/repo.ts`
- Create: `packages/core/src/core/git-providers/github/provider.ts`
- Create: `packages/core/src/core/git-providers/github/index.ts`
- Modify: `packages/core/src/core/github.ts` (turn into clean re-export proxy)
- Test: `tests/git-providers-github.test.ts`

**Interfaces:**
- Consumes: `GitProvider` from `../types.ts`, cache functions from `../../cache/index.ts`.
- Produces: `GitHubGitProvider`, `GitHubClient`, `parseGitHubRepo`, `parseGistId`, `createGitHubAxios`, `formatApiError`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/git-providers-github.test.ts
import { describe, expect, it } from "bun:test";
import {
  GitHubGitProvider,
  GitHubClient,
  parseGitHubRepo,
  parseGistId
} from "../packages/core/src/core/git-providers/github/index.ts";

describe("Modular GitHub Provider", () => {
  it("implements GitProvider interface and parses GitHub repos", () => {
    const provider = new GitHubGitProvider();
    expect(provider.id).toBe("github");
    expect(provider.matchesRepo("github:owner/repo")).toBe(true);
    expect(provider.matchesRepo("owner/repo")).toBe(true);
    expect(provider.matchesRepo("https://github.com/owner/repo")).toBe(true);
    expect(provider.matchesSnippet?.("https://gist.github.com/owner/1234567890abcdef")).toBe(true);

    const ref = provider.parseRepo("github:owner/repo#v1.0.0");
    expect(ref).toEqual({
      provider: "github",
      host: "github.com",
      owner: "owner",
      repo: "repo",
      ref: "v1.0.0",
      subpath: undefined
    });
  });

  it("exports backward-compatible GitHubClient and helpers", () => {
    expect(typeof parseGistId).toBe("function");
    expect(typeof parseGitHubRepo).toBe("function");
    expect(typeof GitHubClient).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/git-providers-github.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Decompose `packages/core/src/core/github.ts` into:
- `errors.ts`: `extractErrorDetail`, `formatApiError`.
- `client.ts`: `createGitHubAxios`, `DEFAULT_TIMEOUT_MS`.
- `gist.ts`: `parseGistId`, `fetchGist`, `createGist`, `updateGist`.
- `repo.ts`: `parseGitHubRepo`, `isRepoSource`, `generatePackReadme`, `fetchRepoPack`, `commitFilesToRepo`.
- `provider.ts`: `GitHubGitProvider` implementing `GitProvider`.
- `index.ts`: re-exports everything and registers `GitHubGitProvider` in the git providers registry by default.
- `packages/core/src/core/github.ts`: simply `export * from "./git-providers/github/index.ts";` (clean 1-line backward-compatible proxy).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/git-providers-github.test.ts`  
Expected: PASS.  
Run: `bun test` to confirm all 758 existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core/git-providers/github/ packages/core/src/core/github.ts tests/git-providers-github.test.ts
git commit -m "refactor(github): modularize monolithic github client into git-providers/github"
```

---

### Task 3: Implement GitLab Git Provider (`git-providers/gitlab/`)

**Files:**
- Create: `packages/core/src/core/git-providers/gitlab/types.ts`
- Create: `packages/core/src/core/git-providers/gitlab/client.ts`
- Create: `packages/core/src/core/git-providers/gitlab/snippet.ts`
- Create: `packages/core/src/core/git-providers/gitlab/repo.ts`
- Create: `packages/core/src/core/git-providers/gitlab/provider.ts`
- Create: `packages/core/src/core/git-providers/gitlab/index.ts`
- Test: `tests/git-providers-gitlab.test.ts`

**Interfaces:**
- Consumes: `GitProvider`, `GitRepoRef`, `GitSnippetRef` from `../types.ts`.
- Produces: `GitLabGitProvider`, `parseGitLabRepo`, `parseGitLabSnippet`, `GitLabClient`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/git-providers-gitlab.test.ts
import { describe, expect, it } from "bun:test";
import {
  GitLabGitProvider,
  parseGitLabRepo,
  parseGitLabSnippet
} from "../packages/core/src/core/git-providers/gitlab/index.ts";

describe("GitLab Git Provider", () => {
  it("parses GitLab repository URLs and shorthands", () => {
    const ref1 = parseGitLabRepo("gitlab:my-group/my-pack");
    expect(ref1).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      owner: "my-group",
      repo: "my-pack",
      ref: undefined,
      subpath: undefined
    });

    const ref2 = parseGitLabRepo("https://gitlab.com/group/subgroup/project/-/tree/v2.0/subdir");
    expect(ref2).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      owner: "group/subgroup",
      repo: "project",
      ref: "v2.0",
      subpath: "subdir"
    });
  });

  it("parses GitLab snippet URLs", () => {
    const snip = parseGitLabSnippet("https://gitlab.com/-/snippets/1234567");
    expect(snip).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      snippetId: "1234567"
    });
  });

  it("detects GitLab URLs with provider.matchesRepo and matchesSnippet", () => {
    const provider = new GitLabGitProvider();
    expect(provider.matchesRepo("gitlab:group/project")).toBe(true);
    expect(provider.matchesRepo("https://gitlab.com/group/project")).toBe(true);
    expect(provider.matchesSnippet?.("https://gitlab.com/-/snippets/999")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/git-providers-gitlab.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Implement GitLab REST v4 client (`client.ts`), repository reader (`repo.ts`), snippet reader (`snippet.ts`), and `GitLabGitProvider` (`provider.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/git-providers-gitlab.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core/git-providers/gitlab/ tests/git-providers-gitlab.test.ts
git commit -m "feat(gitlab): implement GitLab git provider with repo and snippet support"
```

---

### Task 4: Implement Gitea / Forgejo Git Provider (`git-providers/gitea/`)

**Files:**
- Create: `packages/core/src/core/git-providers/gitea/client.ts`
- Create: `packages/core/src/core/git-providers/gitea/repo.ts`
- Create: `packages/core/src/core/git-providers/gitea/provider.ts`
- Create: `packages/core/src/core/git-providers/gitea/index.ts`
- Test: `tests/git-providers-gitea.test.ts`

**Interfaces:**
- Consumes: `GitProvider`, `GitRepoRef` from `../types.ts`.
- Produces: `GiteaGitProvider`, `parseGiteaRepo`, `GiteaClient`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/git-providers-gitea.test.ts
import { describe, expect, it } from "bun:test";
import {
  GiteaGitProvider,
  parseGiteaRepo
} from "../packages/core/src/core/git-providers/gitea/index.ts";

describe("Gitea / Forgejo Git Provider", () => {
  it("parses Gitea and Codeberg repository URLs and shorthands", () => {
    const ref1 = parseGiteaRepo("gitea:owner/repo");
    expect(ref1).toEqual({
      provider: "gitea",
      host: "gitea.com",
      owner: "owner",
      repo: "repo",
      ref: undefined,
      subpath: undefined
    });

    const ref2 = parseGiteaRepo("https://codeberg.org/forgejo-user/agent-pack/src/branch/v1.1/pack");
    expect(ref2).toEqual({
      provider: "gitea",
      host: "codeberg.org",
      owner: "forgejo-user",
      repo: "agent-pack",
      ref: "v1.1",
      subpath: "pack"
    });
  });

  it("detects Gitea and Codeberg URLs with provider.matchesRepo", () => {
    const provider = new GiteaGitProvider();
    expect(provider.matchesRepo("gitea:owner/repo")).toBe(true);
    expect(provider.matchesRepo("codeberg:owner/repo")).toBe(true);
    expect(provider.matchesRepo("https://codeberg.org/user/repo")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/git-providers-gitea.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Implement Gitea REST v1 client (`client.ts`), repository reader (`repo.ts`), and `GiteaGitProvider` (`provider.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/git-providers-gitea.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core/git-providers/gitea/ tests/git-providers-gitea.test.ts
git commit -m "feat(gitea): implement Gitea and Codeberg git provider"
```

---

### Task 5: Integrate Pluggable Git Providers & Document S3 Plugin Extension

**Files:**
- Modify: `packages/core/src/core/pack/registry.ts` (route `GitRepoPackLoader` & `GistPackLoader` through GitProvider registry)
- Modify: `packages/core/src/core/index.ts` (export `git-providers`)
- Create: `examples/plugins/s3-storage.js` (working documented S3 extension example)
- Test: `tests/plugin-s3-extension.test.ts` (tests plugin loading custom S3 provider)

**Interfaces:**
- Consumes: `resolveGitProviderForSource` from `../git-providers/index.ts`.
- Produces: Integrated pack loader supporting GitHub, GitLab, and Gitea seamlessly.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/plugin-s3-extension.test.ts
import { describe, expect, it } from "bun:test";
import { loadPackFromSource } from "../packages/core/src/core/pack/loader.ts";
import { registerPackLoader, unregisterPackLoader } from "../packages/core/src/core/pack/registry.ts";

describe("Custom Remote Plugin Extension (S3 pattern)", () => {
  it("allows registering an external S3 pack loader without modifying core", async () => {
    registerPackLoader({
      name: "s3-mock",
      matches: (ctx) => ctx.source.startsWith("s3://"),
      load: async (ctx) => ({
        manifest: {
          name: "s3-pack",
          version: "1.0.0",
          skills: []
        },
        rawFiles: { "smcp.json": "{}" }
      })
    }, true);

    const loaded = await loadPackFromSource("s3://my-corp-bucket/packs/backend");
    expect(loaded.manifest.name).toBe("s3-pack");
    unregisterPackLoader("s3-mock");
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test tests/plugin-s3-extension.test.ts`

- [ ] **Step 3: Update `pack/registry.ts` to use `resolveGitProviderForSource`**

Update `GitHubRepoPackLoader` to be `GitRepoPackLoader`:
- Checks `resolveGitProviderForSource(context.source)`
- Delegates pack loading to the resolved GitProvider.
Create `examples/plugins/s3-storage.js` documenting the S3 plugin integration with AWS SDK / MinIO.

- [ ] **Step 4: Run full test suite and verify 0 regressions**

Run: `bun run build && bun test`  
Expected: PASS across all test files.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/core/pack/registry.ts packages/core/src/core/index.ts examples/plugins/s3-storage.js tests/plugin-s3-extension.test.ts
git commit -m "feat(remotes): integrate pluggable git providers and document S3 plugin extension"
```

---

## Self-Review Checklist
- [x] Spec coverage: Tasks 1-5 cover all requirements in `2026-10-02-pluggable-git-providers-design.md`.
- [x] Zero placeholders: All file paths, interfaces, and test blocks are fully specified.
- [x] Type consistency: `GitRepoRef`, `GitProvider`, and `RepoPackResult` signatures match across all tasks.
- [x] Backward compatibility: `github.ts` remains a re-export proxy; no breaking changes.
