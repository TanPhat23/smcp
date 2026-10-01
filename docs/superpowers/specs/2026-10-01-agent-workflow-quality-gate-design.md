# Design Specification: OpenCode Agent Workflow Quality Gate & Context Economy

**Date:** 2026-10-01  
**Status:** Draft  
**Target:** OpenCode Agent System (`~/.config/opencode/agents/`) & SMCP Shared Pack  

---

## 1. Problem Statement & Motivation

During autonomous and semi-autonomous coding workflows in OpenCode:
1. **Sloppy Code & Superficial Tests:** Specialist agents often write substandard or over-engineered code and shallow tests that only cover happy paths. Mutation scenarios (off-by-one, boundary values, error branches) and manual runtime verifications are skipped.
2. **Context Dilution:** Overloading subagents with full-repository context or massive instruction dumps degrades LLM reasoning, causing hallucinations and loss of focus.
3. **Premature Completion:** The orchestrator (`coordinator`) frequently accepts implementation claims without requiring concrete terminal execution proof and adversarial test coverage.
4. **Malformed Agent Files:** Existing agent markdown definitions have duplicate frontmatter blocks and lack structured input/output contracts.

---

## 2. Core Architectural Principles

### 2.1 Context Economy
- **Bounded Briefs:** `coordinator` must never dump raw repo context into subagents. Context passed to subagents must consist strictly of:
  - Exact target file paths (typically 1–3 files)
  - The minimal interface/contract definition
  - Concrete acceptance criteria and constraints
- **Diff-Driven Verification:** `quality` receives the target file paths, git diff (`git diff`), and test paths, rather than entire project history.

### 2.2 Anti-Slop Backend Standards (`backend.md`)
- Ban speculative abstractions, unused interfaces, and excessive layers.
- Mandate standard library / established framework idioms over bespoke utilities.
- Require strict input validation at system boundaries and explicit error handling (no swallowed errors).
- Every code change must come with targeted unit tests authored by `backend` for expected functional paths.

### 2.3 Adversarial Quality Gate (`quality.md`)
- **Role:** `quality` acts as an independent adversarial evaluator.
- **Mutation & Boundary Testing Rubric:**
  - Null/undefined/empty collection handling
  - Boundary limits & off-by-one conditions
  - Inverted boolean branches / conditional fallthrough
  - Malformed inputs & network/system error recovery
- **Mandatory Manual Verification Execution:**
  - `quality` must execute actual runtime commands (e.g. CLI invocation, curl command, test command, build script) and capture stdout/exit code.
- **Defect Reporting Protocol:**
  - If a defect or missing edge-case is discovered, `quality` outputs a structured **Defect Report**:
    ```markdown
    ### Defect Report
    - **Severity:** High / Medium / Low
    - **Location:** path/to/file.ts:line
    - **Failed Case:** Description of the mutation/edge failure
    - **Reproduction:** Command or test input that triggers the failure
    - **Expected vs Actual:** Exact behavior mismatch
    ```
  - `quality` does *not* rewrite the backend architecture itself; it feeds the defect report back to `coordinator` for `backend` to fix.

### 2.4 Coordinator Orchestration State Machine (`coordinator.md`)
`coordinator` enforces a strict 4-phase lifecycle:
1. **Phase 1: Scope & Bounded Brief:** Frame the narrowest complete solution with minimal files.
2. **Phase 2: Implementation (`backend`):** Dispatch bounded brief. Receive diff and unit test confirmation.
3. **Phase 3: Adversarial Quality Gate (`quality`):** Dispatch diff and acceptance criteria. `quality` runs mutation checks and manual command execution.
   - If defects found: loop back to Phase 2 with the Defect Report.
   - If clean: proceed to Phase 4.
4. **Phase 4: Final Sign-off:** `coordinator` validates the verification evidence (terminal output, test results) before declaring completion.

### 2.5 Clean Agent Definitions
Fix all existing agent definitions in `~/.config/opencode/agents/` (`coordinator.md`, `backend.md`, `quality.md`, `security.md`, `delivery.md`, `docs.md`):
- Eliminate duplicate YAML frontmatter headers.
- Standardize metadata (`name`, `description`, `mode`, `color`, `permission`).
- Embed the bounded brief, anti-slop, and adversarial quality contracts directly into the system prompts.

---

## 3. smcp Synchronization

Once local agent definitions are updated and verified:
1. Run local test suite (`bun test`) to ensure no regressions in smcp core or cli.
2. Use `smcp share -a opencode -P gist -y --json` to update the published GitHub Gist (`b9cf07a7322f43f60c92481b12c680c4`) with the enhanced agent workflows.

---

## 4. Verification & Success Criteria

1. All 6 agent markdown files have valid single YAML frontmatters and clean schemas.
2. `coordinator` instructions contain the 4-phase lifecycle and ban completion without evidence.
3. `quality` instructions contain the mutation rubric, defect report format, and manual command verification mandate.
4. `backend` instructions contain strict anti-slop rules and bounded test authoring.
5. `smcp list` and `smcp inspect` cleanly parse all updated agent definitions without error.
6. The updated pack is synchronized to GitHub Gist with version incremented.
