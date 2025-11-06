# Construct Runtime

This document covers the high-level runtime behavior of constructs. For detailed implementation specifications see the individual feature documents.

## Core Concepts

### Construct Types (Rescoped)
- **Basic**: Simple construct entity with metadata only (Step 2)
- **With Worktree**: Basic construct + isolated git worktree (Step 3)
- **With Agent**: Basic construct + worktree + OpenCode agent session (Step 4)

### Future Construct Types (Phase 1A+)
- **Implementation (full)**: launches the agent with the full tool/toolbox defined by the workspace. Use the standard prompt assembly pipeline and allow file writes, command execution, etc.
- **Planning**: launches OpenCode in plan mode (limited toolset). See [[features/phase-3/planning-handoff|Planning-to-Implementation Handoff]] for detailed workflow.
- **Manual**: skip agent creation entirely. Services still provision, the worktree is created, and Synthetic exposes diff/log views; the user drives work manually via their own editor/terminal or via MCP/CLI helpers.

### Runtime Environment (Current)
- Constructs run directly in host environment so agents share the user's credentials, PATH, and dependencies; no supervised pods for v1.
- Each construct operates in its own git worktree (when enabled) to prevent conflicts with other constructs and the main workspace.
- **Note**: Port allocation deferred to Phase 1A - not needed for basic agent functionality.

### Runtime Environment (Future Phase 1A)
- Port allocation probes the real host OS to avoid collisions between constructs and with running services.
- Service management and process lifecycle for development environments.

## Implementation Features

The runtime behavior is implemented through these core features:

- **[[features/phase-0/agent-orchestration|Agent Orchestration Engine]]**: Manages agent sessions, authentication, and lifecycle events
- **[[features/phase-0/persistence-layer|Persistence Layer]]**: Provides SQLite-based storage with ACID guarantees
- **[[features/phase-3/planning-handoff|Planning-to-Implementation Handoff]]**: Handles workflow transitions between construct types
- **[[features/phase-0/template-definition-system|Template Definition System]]**: Defines services and environments for constructs
- **[[features/phase-0/prompt-assembly-pipeline|Prompt Assembly Pipeline]]**: Assembles agent prompts from multiple sources

## Related Features
See [[features/phase-1/service-control|Service Control]], [[features/phase-1/workspace-switching|Workspace Discovery & Switching]], [[features/phase-1/docker-compose-support|Docker & Compose Support]], and [[features/phase-1/diff-review|Diff Review]] for additional runtime capabilities.
