# Cells Overview

See also: [[runtime|Runtime]], [[../configuration|Workspace & Templates]], [[../testing|Testing Strategy]], and [[../implementation-strategy|Implementation Strategy]].

## Core Infrastructure (Rescoped)
The foundational features that enable core cell functionality:
- [[features/phase-0/template-definition-system|Template Definition System]] ✅ **COMPLETED**
- [[../core-functionality-path|Basic Cell Management]] ✅ **PR #2**
- [[../core-functionality-path|Git Worktree Integration]] 🔄 **PR #3**
- [[../core-functionality-path|Agent Integration]] 🔄 **PR #4**

### Deferred Features (Prepared but Not Implemented)
- [[features/phase-0/agent-orchestration|Agent Orchestration Engine]] 🔄 **Deferred to Phase 1A**
- [[features/phase-0/cell-creation|Cell Creation & Provisioning]] 🔄 **Deferred to Phase 1A**
- [[features/phase-0/persistence-layer|Persistence Layer]] 🔄 **Deferred to Phase 1A**
- [[features/phase-0/prompt-assembly-pipeline|Prompt Assembly Pipeline]] 🔄 **Deferred to Phase 1A**
- [[features/phase-3/planning-handoff|Planning-to-Implementation Handoff]] 🔄 **Phase 3**

## Vision & Goals
- Centralize multi-agent coding work so each task runs inside an isolated "cell" with its own workspace, services, and context.
- Lower the cognitive overhead of juggling multiple agents by surfacing status, queues, and review artifacts in one UI.
- Keep users inside Hive for review by embedding diffs, file browsing, and agent transcripts.
- Treat Hive as an extension of the developer environment: agents inherit local toolchains, environment variables, and access to running services.
- Optimize for a single operator managing their own project; multi-user coordination is out of scope for v1.

## Cell Model (Rescoped)
- **Definition**: A cell bundles basic metadata, optional worktree, and optional agent session. Cells are instantiated from reusable templates defined in `hive.config.ts`; each cell is owned and operated by the same single user who controls the workspace.
- **Core Lifecycle**: Create (basic entity) → Extend with worktree (optional) → Extend with agent session (optional)
- **State Capture**: Persist basic metadata (name, description, template_id). Additional features (worktree, agent) extend this base entity.

### Progressive Enhancement
1. **Step 2**: Basic cell entity (name, description, template_id)
2. **Step 3**: Add worktree capability (workspace_path)
3. **Step 4**: Add agent capability (sessions, messages)

### Future Full Lifecycle (Phase 1A)
When deferred features are implemented, cells will support:
- Draft brief → Template selection & provisioning (run setup tasks & services) → Active (agent executing) → Awaiting Review (agent paused / needs input) → Reviewing (human diff/feedback) → Complete or Parked (snapshot for later)

### Agent Lifecycle
- **Starting**: services provisioned, prompts assembled, and a new agent session bootstrapped. The UI shows a spinner until we receive the first assistant message or readiness signal.
- **Working**: the agent is actively processing the latest prompt. Services stay running and log output continues to stream.
- **Awaiting Input**: the agent requested human feedback (e.g. “Need credentials” or “Please review diff”). The cell appears in the awaiting-input queue until the user replies.
- **Completed**: the user marks the cell done (or the agent reports success). Services are stopped, the session is closed, and the cell becomes read-only until archived or cloned.
- **Archived**: long-term storage. No services or agent sessions run, but transcripts and artifacts remain accessible.
- **Error**: an unrecoverable failure (e.g., agent crash). Hive records the error, stops services, and prompts the user to resume or close out after investigating.

Cell status is computed from service + agent state. If any service is flagged `needs_resume` or the agent requires rehydration, the UI surfaces a “Resume cell” banner (and optional per-component controls), but the overall lifecycle remains in its last logical state (e.g., Active or Awaiting Input) until the user takes action.

### Dogfooding Requirements
- The Hive repository itself must be runnable as a workspace so the platform can build and test itself; templates and tooling must work when the app is under active development.
- Port allocation always probes the real host (not just internal state) so cells spawned inside Hive avoid collisions with the live instance.
- Every cell operates in its own git worktree; installs and commands run in that worktree to prevent lockfile or artifact conflicts with the running workspace.
- Templates reference paths relative to the workspace root so dogfooding instances inherit prompts, configs, and scripts without special casing.

### Single-User Assumptions
- Hive assumes a single operator per workspace for v1; no shared accounts, concurrent edits, or cross-user notifications are supported.
- Cell ownership, notifications, and status changes target that operator alone; collaboration workflows remain future scope.

## Core Infrastructure Features

**Phase 0 – Foundation**
- [[features/phase-0/agent-orchestration|Agent Orchestration Engine]]: core engine for managing agent sessions, authentication, and lifecycle events
- [[features/phase-0/cell-creation|Cell Creation & Provisioning]]: template selection, workspace setup, and service initialization
- [[features/phase-0/agent-chat-ux|Agent Chat UX]]: responsive chat interface for agent interactions
- [[features/phase-0/persistence-layer|Persistence Layer]]: reliable storage for cells, transcripts, and artifacts with SQLite
- [[features/phase-0/template-definition-system|Template Definition System]]: flexible, type-safe system for defining cell templates
- [[features/phase-0/prompt-assembly-pipeline|Prompt Assembly Pipeline]]: robust system for assembling agent prompts from multiple sources



## Future Extensions Roadmap

**Phase 1 – Core Runtime**
- [[features/phase-1/diff-review|Diff review]]: comprehensive diff review experience with Difftastic integration and staging/reverting capabilities.
- [[features/phase-1/docker-compose-support|Docker & Compose support]]: enable cells to use Docker containers and Docker Compose for services.
- [[features/phase-1/service-control|Service control]]: comprehensive service management through UI, CLI, and MCP tools.
- [[features/phase-1/workspace-switching|Workspace discovery & switching]]: allow users to manage multiple workspaces and switch between them.

**Phase 2 – Advanced Interaction**
- [[features/phase-2/voice-input|Voice input]]: feature removed from current release; voice capture and transcription will be revisited before any reintroduction.
- [[features/phase-2/sparse-cells|Sparse cells]]: allow launching a cell with agent-only mode (no services) for light-weight exploratory work.
- [[features/phase-2/template-prompt-viewer|Template prompt viewer]]: provide a UI to preview a template's concatenated prompts, including estimated token count and the exact fragments that will be sent to the agent.
- [[features/phase-2/compaction-logging|Compaction logging]]: surface agent compaction events/tokens so users can monitor prompt degradation over long sessions.
- [[features/phase-2/linear-integration|Linear integration]]: create cells directly from Linear issues and sync plan/implementation status back to Linear.
- [[features/phase-2/github-integration|GitHub integration]]: start cells from non-main branches, detect existing PR branches, and optionally open PRs when a cell finishes. Support cloning a branch, working in an isolated copy, and linking cell status back to GitHub PRs.

**Phase 3 – Planning & Collaboration**
- [[features/phase-3/planning-handoff|Planning-to-Implementation Handoff]]: workflow transitions between planning and implementation phases, including planning agent type and plan submission/approval
- [[features/phase-3/reference-repos|Reference repos]]: support cloning remote repositories into read-only worktrees so agents can learn from external code before planning/implementation.
- [[features/phase-3/config-editor|Config editor]]: offer a UX for editing `hive.config.ts` (or a companion YAML/JSON) with validation, to be explored once the config API stabilizes.
- [[features/phase-3/inline-prompt-editor|Inline prompt editor]]: optional rich markdown editor for prompt fragments (`docs/prompts/**/*.md`) so users can tweak agent briefing without leaving Hive. (Evaluate effort/benefit before building.)
- [[features/phase-3/context-switching-aids|Context switching aids]]: help users quickly regain context when returning to cells or switching between tasks.
- [[features/phase-3/plan-export|Plan export]]: send planning outcomes to external systems (Linear tickets, GitHub issues, etc.) from within Hive.
- [[features/phase-3/prompt-optimisation|Prompt optimisation]]: analyze prompt bundles for redundant context and token bloat, suggest pruning or consolidation before dispatching to agents, and surface token delta per edit.

**Phase 4 – Analytics & Terminal**
- [[features/phase-4/insight-analytics|Insight analytics]]: evolve the metrics baseline into trend reporting (cycle time, agent idle time) with slice/dice filters and export.
- [[features/phase-4/activity-timeline|Activity timeline]]: chronological view of cell activity with diff summaries and filtering.
- [[features/phase-4/terminal-ui|Terminal UI]]: add a TUI front-end (via `@sst/opentui`) mirroring the web experience for terminal-first workflows.

## Open Questions
- What retention policy should we adopt for persisted logs and artifacts to balance disk usage with traceability? (Likely answer: surface per-cell storage usage with manual cleanup controls, plus optional auto-prune thresholds.)
