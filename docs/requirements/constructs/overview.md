# Constructs Overview

See also: [[runtime|Runtime]], [[ux/overview|UX Overview]], [[ux/agent-chat|Agent Chat UX]], [[../configuration|Workspace & Templates]], [[features/index|Construct Features Roadmap]], and [[../testing|Testing Strategy]].

## Core Infrastructure
The foundational features that enable all construct functionality:
- [[features/agent-orchestration|Agent Orchestration Engine]]
- [[features/persistence-layer|Persistence Layer]] 
- [[features/template-definition-system|Template Definition System]]
- [[features/prompt-assembly-pipeline|Prompt Assembly Pipeline]]
- [[features/configuration-validation|Configuration Validation]]
- [[features/planning-handoff|Planning-to-Implementation Handoff]]

## Vision & Goals
- Centralize multi-agent coding work so each task runs inside an isolated "construct" with its own workspace, services, and context.
- Lower the cognitive overhead of juggling multiple agents by surfacing status, queues, and review artifacts in one UI.
- Keep users inside Synthetic for review by embedding diffs, file browsing, and agent transcripts.
- Treat Synthetic as an extension of the developer environment: agents inherit local toolchains, environment variables, and access to running services.
- Optimize for a single operator managing their own project; multi-user coordination is out of scope for v1.

## Construct Model
- **Definition**: A construct bundles the task brief, linked worktree, configured services, agent session, and history of actions. Constructs are instantiated from reusable templates defined in `synthetic.config.ts`; each construct is owned and operated by the same single user who controls the workspace.
- **Lifecycle (v1)**: Draft brief → Template selection & provisioning (run setup tasks & services) → Active (agent executing) → Awaiting Review (agent paused / needs input) → Reviewing (human diff/feedback) → Complete or Parked (snapshot for later).
- **State Capture**: Persist key metadata (task, status, timestamps), agent transcript, shell command log, and diff bundles for context restoration. Retain the template reference so users can rehydrate or clone constructs.

### Agent Lifecycle
- **Starting**: services provisioned, prompts assembled, and a new agent session bootstrapped. The UI shows a spinner until we receive the first assistant message or readiness signal.
- **Working**: the agent is actively processing the latest prompt. Services stay running and log output continues to stream.
- **Awaiting Input**: the agent requested human feedback (e.g. “Need credentials” or “Please review diff”). The construct appears in the awaiting-input queue until the user replies.
- **Completed**: the user marks the construct done (or the agent reports success). Services are stopped, the session is closed, and the construct becomes read-only until archived or cloned.
- **Archived**: long-term storage. No services or agent sessions run, but transcripts and artifacts remain accessible.
- **Error**: an unrecoverable failure (e.g., agent crash). Synthetic records the error, stops services, and prompts the user to resume or close out after investigating.

Construct status is computed from service + agent state. If any service is flagged `needs_resume` or the agent requires rehydration, the UI surfaces a “Resume construct” banner (and optional per-component controls), but the overall lifecycle remains in its last logical state (e.g., Active or Awaiting Input) until the user takes action.

### Dogfooding Requirements
- The Synthetic repository itself must be runnable as a workspace so the platform can build and test itself; templates and tooling must work when the app is under active development.
- Port allocation always probes the real host (not just internal state) so constructs spawned inside Synthetic avoid collisions with the live instance.
- Every construct operates in its own git worktree; installs and commands run in that worktree to prevent lockfile or artifact conflicts with the running workspace.
- Templates reference paths relative to the workspace root so dogfooding instances inherit prompts, configs, and scripts without special casing.

### Single-User Assumptions
- Synthetic assumes a single operator per workspace for v1; no shared accounts, concurrent edits, or cross-user notifications are supported.
- Construct ownership, notifications, and status changes target that operator alone; collaboration workflows remain future scope.

## Core Infrastructure Features

**Phase 0 – Foundation**
- [[features/agent-orchestration|Agent Orchestration Engine]]: core engine for managing agent sessions, authentication, and lifecycle events
- [[features/persistence-layer|Persistence Layer]]: reliable storage for constructs, transcripts, and artifacts with SQLite
- [[features/template-definition-system|Template Definition System]]: flexible, type-safe system for defining construct templates
- [[features/prompt-assembly-pipeline|Prompt Assembly Pipeline]]: robust system for assembling agent prompts from multiple sources

## Future Extensions Roadmap

**Phase 1 – Core Runtime**
- [[features/diff-review|Diff review]]: comprehensive diff review experience with Difftastic integration and staging/reverting capabilities.
- [[features/docker-compose-support|Docker & Compose support]]: enable constructs to use Docker containers and Docker Compose for services.
- [[features/service-control|Service control]]: comprehensive service management through UI, CLI, and MCP tools.
- [[features/workspace-switching|Workspace discovery & switching]]: allow users to manage multiple workspaces and switch between them.

**Phase 2 – Advanced Interaction**
- [[features/voice-input|Voice input]]: add microphone capture, streaming transcription, and push-to-talk UX inside agent conversations; fall back to text if transcription fails.
- [[features/sparse-constructs|Sparse constructs]]: allow launching a construct with agent-only mode (no services) for light-weight exploratory work.
- [[features/template-prompt-viewer|Template prompt viewer]]: provide a UI to preview a template's concatenated prompts, including estimated token count and the exact fragments that will be sent to the agent.
- [[features/compaction-logging|Compaction logging]]: surface agent compaction events/tokens so users can monitor prompt degradation over long sessions.
- [[features/linear-integration|Linear integration]]: create constructs directly from Linear issues and sync plan/implementation status back to Linear.
- [[features/github-integration|GitHub integration]]: start constructs from non-main branches, detect existing PR branches, and optionally open PRs when a construct finishes. Support cloning a branch, working in an isolated copy, and linking construct status back to GitHub PRs.

**Phase 3 – Planning & Collaboration**
- [[features/planning-handoff|Planning-to-Implementation Handoff]]: workflow transitions between planning and implementation phases, including planning agent type and plan submission/approval
- [[features/reference-repos|Reference repos]]: support cloning remote repositories into read-only worktrees so agents can learn from external code before planning/implementation.
- [[features/config-editor|Config editor]]: offer a UX for editing `synthetic.config.ts` (or a companion YAML/JSON) with validation, to be explored once the config API stabilizes.
- [[features/inline-prompt-editor|Inline prompt editor]]: optional rich markdown editor for prompt fragments (`docs/prompts/**/*.md`) so users can tweak agent briefing without leaving Synthetic. (Evaluate effort/benefit before building.)
- [[features/context-switching-aids|Context switching aids]]: help users quickly regain context when returning to constructs or switching between tasks.
- [[features/plan-export|Plan export]]: send planning outcomes to external systems (Linear tickets, GitHub issues, etc.) from within Synthetic.
- [[features/prompt-optimisation|Prompt optimisation]]: analyze prompt bundles for redundant context and token bloat, suggest pruning or consolidation before dispatching to agents, and surface token delta per edit.

**Phase 4 – Analytics & Terminal**
- [[features/insight-analytics|Insight analytics]]: evolve the metrics baseline into trend reporting (cycle time, agent idle time) with slice/dice filters and export.
- [[features/activity-timeline|Activity timeline]]: chronological view of construct activity with diff summaries and filtering.
- [[features/terminal-ui|Terminal UI]]: add a TUI front-end (via `@sst/opentui`) mirroring the web experience for terminal-first workflows.

## Open Questions
- What retention policy should we adopt for persisted logs and artifacts to balance disk usage with traceability? (Likely answer: surface per-construct storage usage with manual cleanup controls, plus optional auto-prune thresholds.)
