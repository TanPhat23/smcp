# Implementation Plan: Extensibility System (Pluggable Auth, Library SDK, and CLI Extensions)

## Objective
Enable third-party users and developers to seamlessly extend `smcp` both as a global CLI binary and as an imported library SDK:
1. **Pluggable Auth System**: Decouple authentication from GitHub with `AuthProvider` strategy registry, supporting generic provider tokens while preserving full backward compatibility.
2. **Programmatic Library SDK Entrypoint**: Export all public registries, types, mergers, loaders, redactors, and clients from `src/index.ts` with clean `package.json` exports.
3. **CLI Extension / Plugin Autoloader**: Automatically load user scripts from `~/.smcp/plugins/*.{js,mjs,ts}` and `./smcp.config.{js,mjs,ts}` at CLI startup so installed CLI users can register custom loaders, share providers, adapters, and secret patterns without touching source code.

---

## Tasks

### Task 1: Pluggable Auth Provider Strategy & Registry
- **Files**:
  - `src/types/auth.ts`: Update `AuthConfigSchema` with `.passthrough()`, `tokens: Record<string, string>`, and `providers: Record<string, ProviderAuthInfo>`.
  - `src/core/auth/types.ts`: Define `AuthUser`, `AuthProviderContext`, `AuthProvider`.
  - `src/core/auth/github.ts`: Built-in `GitHubAuthProvider` with token verification, OAuth scope detection (`repo`, `gist`), and error handling.
  - `src/core/auth/registry.ts`: `registerAuthProvider`, `unregisterAuthProvider`, `getAuthProvider`, `getAllAuthProviders`, `resetAuthProviders`.
  - `src/core/auth/index.ts`: Re-export types and registry.
  - `src/core/state/auth.ts`: Add `getAuthToken(provider?: string)` and `saveProviderAuth(provider, token, user, metadata)`.
  - `src/commands/auth/login.ts`, `status.ts`, `logout.ts`: Update commands to accept optional `[provider]` argument (defaulting to `"github"`).

### Task 2: Programmatic Library SDK Entrypoint
- **Files**:
  - `src/index.ts`: Export all public types, pack loaders & registry, share providers & registry, MCP adapters & registry, secret redactor engine & detector registration, agent detection & custom profiles, auth providers & state, and HTTP/GitHub clients.
  - `package.json`: Configure `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, `"exports": { ".": "./dist/index.js", "./cli": "./dist/cli.js" }`.
  - Build script in `package.json`: Compile both `src/cli.ts` -> `dist/cli.js` and `src/index.ts` -> `dist/index.js` with TypeScript type declarations.

### Task 3: CLI Extension / Plugin Autoloader
- **Files**:
  - `src/core/extensions/loader.ts`: Scan and safely load user extensions from:
    - User home directory: `~/.smcp/plugins/*.{js,mjs,cjs,ts}`
    - Current working directory: `./smcp.config.{js,mjs,cjs,ts}` and `./.smcp/plugins/*.{js,mjs,ts}`
  - Error isolation: Catch and log warnings if an extension script throws, without crashing the CLI.
  - `src/cli.ts`: Call `await loadUserExtensions()` before executing command actions.
  - `src/commands/instructions.ts`: Update documentation explaining how users can create custom extensions in `~/.smcp/plugins/` or `smcp.config.js`.

### Task 4: Test Suite & Verification
- **Files**:
  - `tests/auth-providers.test.ts`: Test `registerAuthProvider`, token resolution, scope verification, and custom auth providers.
  - `tests/extensions.test.ts`: Test extension loading from directories, error isolation, and CLI registration.
  - `tests/library.test.ts`: Test importing public symbols from library entrypoint.
  - Full suite verification: Ensure all 395+ tests pass with 0 regressions.
