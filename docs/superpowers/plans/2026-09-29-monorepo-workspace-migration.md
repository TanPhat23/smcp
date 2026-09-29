# Implementation Plan: Bun Workspace Monorepo Migration

## Objective
Formalize the repository as a true multi-package Bun workspace monorepo:
1. `packages/core` (`@smcp/core`): Headless core SDK containing types, utils, and core engines (agents, auth, merger, pack, redactor, state, storage, lifecycle, extensions, http, github). Zero CLI/terminal UI dependencies.
2. `packages/cli` (`smcp`): Interactive CLI tool and high-level commands, consuming `@smcp/core` via `workspace:*`. Includes Commander, Clack prompts, Picocolors, and the executable binary.
3. Root Monorepo Orchestration: Root workspace configuration, path mappings, unified test runners, and build pipelines.

---

## Tasks

### Task 1: Create `packages/core` (@smcp/core)
- Directory: `packages/core`
- `packages/core/package.json` with dependencies on `axios` and `zod`.
- `packages/core/tsconfig.json` & `packages/core/tsconfig.build.json`.
- Move/copy `src/types/`, `src/utils/`, and `src/core/` to `packages/core/src/`.
- Create `packages/core/src/index.ts` re-exporting all types, utils, and core modules.
- Build and verify `@smcp/core` compiles cleanly with TypeScript declarations.

### Task 2: Create `packages/cli` (smcp)
- Directory: `packages/cli`
- `packages/cli/package.json` with dependency on `"@smcp/core": "workspace:*"`, `@clack/prompts`, `commander`, `picocolors`, `zod`.
- Move/copy `src/commands/` and `src/cli.ts` to `packages/cli/src/`.
- Update command imports from `../../core/...`, `../../types/...`, `../../utils/...` to `@smcp/core`.
- Create `packages/cli/src/index.ts` re-exporting `@smcp/core` and all high-level commands.
- Create `packages/cli/src/core.ts` re-exporting `@smcp/core` (for `smcp/core` subpath export backward compatibility).
- Set up `packages/cli/bin/smcp.js`.

### Task 3: Root Workspace Configuration & Cleanup
- Configure root `package.json` with `"workspaces": ["packages/*"]`.
- Update root `tsconfig.json` with path mappings for `@smcp/core` and `smcp`.
- Update root `bin/smcp.js` to point to `packages/cli/dist/cli.js`.
- Remove legacy `src/` directory after verification.
- Update test import paths or verify root test suite imports.

### Task 4: Verification & Test Suite
- Run `bun install` to link workspace packages.
- Run `bun run build` across all packages.
- Run `bun run typecheck`.
- Run full 500-test suite (`bun test`).
- Verify CLI execution (`node bin/smcp.js --help`, `node packages/cli/bin/smcp.js --version`).
