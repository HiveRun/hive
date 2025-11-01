# Construct Runtime

This document covers the high-level runtime behavior of constructs. For detailed implementation specifications see the individual feature documents.

## Core Concepts

### Construct Types
- **Implementation (default)**: launches the agent with the full tool/toolbox defined by the workspace. Use the standard prompt assembly pipeline and allow file writes, command execution, etc.
- **Planning**: launches OpenCode in plan mode (limited toolset). See [[features/planning-handoff|Planning-to-Implementation Handoff]] for detailed workflow.
- **Manual**: skip agent creation entirely. Services still provision, the worktree is created, and Synthetic exposes diff/log views; the user drives work manually via their own editor/terminal or via MCP/CLI helpers.

### Runtime Environment
- Constructs run directly in the host environment so agents share the user's credentials, PATH, and dependencies; no supervised pods for v1.
- Each construct operates in its own git worktree to prevent conflicts with other constructs and the main workspace.
- Port allocation probes the real host OS to avoid collisions between constructs and with running services.

## Implementation Features

The runtime behavior is implemented through these core features:

- **[[features/agent-orchestration|Agent Orchestration Engine]]**: Manages agent sessions, authentication, and lifecycle events
- **[[features/persistence-layer|Persistence Layer]]**: Provides SQLite-based storage with ACID guarantees
- **[[features/planning-handoff|Planning-to-Implementation Handoff]]**: Handles workflow transitions between construct types
- **[[features/template-definition-system|Template Definition System]]**: Defines services and environments for constructs
- **[[features/prompt-assembly-pipeline|Prompt Assembly Pipeline]]**: Assembles agent prompts from multiple sources
- **[[features/configuration-validation|Configuration Validation]]**: Validates configuration before provisioning

## Related Features
See [[features/service-control|Service Control]], [[features/workspace-switching|Workspace Discovery & Switching]], [[features/docker-compose-support|Docker & Compose Support]], and [[features/diff-review|Diff Review]] for additional runtime capabilities.
