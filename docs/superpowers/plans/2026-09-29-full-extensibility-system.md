# Implementation Plan: Full System Extensibility (Manifest Openness, In-Memory Agents, Lifecycle Hooks, CLI Command Registration, and Pluggable Storage)

## Objective
Upgrade `smcp` from having pluggable auth/loaders/share providers to a **100% fully extensible platform** across all subsystems:
1. **Manifest Openness & In-Memory Agent Profiles**: Open `ManifestSchema` with `.passthrough()` to support arbitrary metadata and custom pack assets. Add runtime in-memory `registerAgentProfile` with precedence over disk config and defaults.
2. **Lifecycle Hooks & Middleware Pipeline**: Implement an event/hook engine (`beforeShare`, `afterShare`, `beforeInstall`, `afterInstall`) allowing security scanning, post-install builds, and telemetry.
3. **CLI Command & Flag Extensibility**: Move extension discovery before `program.parseAsync()` and provide `registerCliCommand()` so plugins can register first-class subcommands (e.g. `smcp sync`, `smcp doctor`).
4. **Pluggable Storage Provider Strategy**: Decouple config and history storage from flat JSON files on disk with a `StorageProvider` strategy interface.

---\n
## Tasks

### Task 1: Manifest Openness & In-Memory Agent Profiles
- **Files**:
  - `src/types/manifest.ts`: Add `.passthrough()` to `ManifestSchema` and update `Manifest` interface with `[key: string]: unknown`.
  - `src/core/agents/profiles.ts`: Add in-memory runtime registry: `registerAgentProfile(id, profile, prepend?)`, `unregisterAgentProfile(id)`, `resetAgentProfiles()`.
  - Precedence in `getAgentProfiles()`: in-memory registered > `custom-agents.json` > `DEFAULT_AGENTS`.
  - Prevent prototype pollution keys.
  - Re-export in `src/core/agents/index.ts`, `src/core/index.ts`, and `src/index.ts`.
  - Unit tests in `tests/agents.test.ts`.

### Task 2: Lifecycle Hooks & Middleware Pipeline
- **Files**:
  - `src/core/lifecycle/types.ts`: Define `LifecycleEvent`, context types (`BeforeShareContext`, `AfterShareContext`, `BeforeInstallContext`, `AfterInstallContext`), and `HookFn`.
  - `src/core/lifecycle/hooks.ts`: Implement `registerHook` / `on`, `unregisterHook`, `triggerHook`, `resetHooks`.
  - `src/core/lifecycle/index.ts`: Re-export in `src/core/index.ts` and `src/index.ts`.
  - `src/commands/share/share.ts`: Trigger `beforeShare` and `afterShare`.
  - `src/commands/install/install.ts`: Trigger `beforeInstall` and `afterInstall`.
  - Unit tests in `tests/lifecycle.test.ts`.

### Task 3: CLI Plugin Command Extensibility (Pre-Parse Bootstrapping)
- **Files**:
  - `src/core/cli-registry.ts`: Implement `registerCliCommand(factory: (program: Command) => void)`, `getCliCommandRegistrations()`, `resetCliCommands()`.
  - `src/cli.ts`:
    - Move plugin loading before `program.parseAsync()`: scan CLI flags early for `--no-plugins` / `--no-extensions` or `SMCP_DISABLE_EXTENSIONS=1`.
    - Apply custom command factories from `getCliCommandRegistrations()`.
  - Re-export in `src/core/index.ts` and `src/index.ts`.
  - Unit tests in `tests/cli-extensions.test.ts`.

### Task 4: Pluggable Storage Provider Strategy
- **Files**:
  - `src/core/state/storage/types.ts`: Define `StorageProvider` interface (`name`, `getItem`, `setItem`, `removeItem`).
  - `src/core/state/storage/file.ts`: Implement default `FileStorageProvider` preserving atomic 0o600 file writes.
  - `src/core/state/storage/registry.ts`: Implement `registerStorageProvider`, `getStorageProvider`, `resetStorageProvider`.
  - `src/core/state/storage/index.ts`: Re-export in `src/core/state/index.ts`.
  - Update `src/core/state/auth.ts` and `src/core/state/history.ts` to route through active storage provider.
  - Unit tests in `tests/storage.test.ts`.

### Task 5: Documentation, SDK Exports & Verification
- Update `src/commands/instructions.ts` to describe the full plugin capabilities.
- Run typecheck, full test suite (`bun test`), and build bundle (`bun run build`).
