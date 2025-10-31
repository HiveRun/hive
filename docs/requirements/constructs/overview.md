# Constructs Overview

See also: [Runtime](runtime.md), [UX Overview](ux/overview.md), [Agent Chat UX](ux/agent-chat.md), [Workspace & Templates](../configuration.md), and [Testing Strategy](../testing.md).

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

### Dogfooding Requirements
- The Synthetic repository itself must be runnable as a workspace so the platform can build and test itself; templates and tooling must work when the app is under active development.
- Port allocation always probes the real host (not just internal state) so constructs spawned inside Synthetic avoid collisions with the live instance.
- Every construct operates in its own git worktree; installs and commands run in that worktree to prevent lockfile or artifact conflicts with the running workspace.
- Templates reference paths relative to the workspace root so dogfooding instances inherit prompts, configs, and scripts without special casing.

### Single-User Assumptions
- Synthetic assumes a single operator per workspace for v1; no shared accounts, concurrent edits, or cross-user notifications are supported.
- Construct ownership, notifications, and status changes target that operator alone; collaboration workflows remain future scope.

## Future Extensions Roadmap

**Phase 1 – Post-MVP Foundations**
- `Templates & snippets`: ship a library of reusable construct briefs/manifests with tagging and quick-start selection.
- `Cross-construct search`: index transcripts, command logs, and artifacts so users can find prior solutions; ship with simple keyword search UI.
- `Metrics baseline`: capture per-construct timing (active vs waiting) and human intervention count; expose read-only dashboard inside Synthetic.

**Phase 2 – Collaboration & Governance**
- `Collaboration suite`: allow assigning owners, sharing read-only construct views, and pushing status updates to external trackers (linear/jira webhook).
- `Security guardrails`: implement secret scanning on agent outputs, per-construct access controls, and configurable retention windows for transcripts/artifacts.

**Phase 3 – Advanced Interaction**
- `Voice input`: add microphone capture, streaming transcription, and push-to-talk UX inside agent conversations; fall back to text if transcription fails.
- `Insight analytics`: evolve the metrics baseline into trend reporting (cycle time, agent idle time) with slice/dice filters and export.

## Open Questions
- What retention policy should we adopt for persisted logs and artifacts to balance disk usage with traceability?
