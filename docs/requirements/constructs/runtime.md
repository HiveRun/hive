# Construct Runtime

This document covers the runtime behavior of constructs. For configuration details see [Workspace & Templates](../configuration.md).

## Agent Orchestration
- Anchor on the official OpenCode SDK for all agent interactions (init sessions, send prompts, stream tool events, fetch artifacts). Avoid TUI screen scraping.
- Keep a local clone of <https://github.com/sst/opencode> in `vendor/opencode/` for reference only; production code must depend on the published `@opencode-ai/sdk` package, never the clone.
- Run constructs directly in the host environment so agents share the user's credentials, PATH, and dependencies; no supervised pods for v1.
- Before creating an OpenCode session, inspect the user's OpenCode config/auth store (`auth.json`) to confirm credentials exist for the provider the template demands; if missing, block the session and prompt the user to run `opencode auth login` (no additional runtime retries beyond surfacing the error toast).
- Assemble each agent session prompt from a base Markdown primer describing Synthetic, constructs, and the agent's role; append construct-specific context (task brief, running services, resolved ports/URLs, constraints on external resources).

## Construct Types
- **Implementation (default)**: launches the agent with the full tool/toolbox defined by the workspace. Use the standard prompt assembly pipeline and allow file writes, command execution, etc.
- **Planning**: launches OpenCode in plan mode (limited toolset). Synthetic injects the planning primer and exposes an MCP endpoint (e.g. `synthetic.plan.submit`) that the agent must call with the generated plan. Synthetic stores the plan (e.g. in SQLite + `PLAN.md`) and updates history snapshots. No direct code edits are expected while in this type.
- **Manual**: skip agent creation entirely. Services still provision, the worktree is created, and Synthetic exposes diff/log views; the user drives work manually via their own editor/terminal or via MCP/CLI helpers.

### Planning to Implementation Handoff
- When a planning construct submits a plan via the MCP, mark it `awaiting_input` and surface the rendered plan to the user for approval.
- Approval creates (or converts into) an implementation construct: Synthetic spawns a fresh implementation-mode agent seeded with the stored plan context and links the two constructs for traceability. Users can alternatively start a manual construct from the same plan if they want to execute changes themselves.
- If revisions are requested, the plan agent continues in plan mode until the user approves; each submission overwrites the stored plan while retaining a history entry so reviewers can compare versions.

## Persistence
- Use SQLite as the primary store for constructs, transcripts, statuses, and metadata so we gain ACID writes with minimal setup.
- Persist large artifacts, command logs, and diff bundles as raw files on disk referenced from the SQLite tables for fast streaming in the UI.
- Keep migration overhead light by versioning the schema alongside app releases and offering a simple `synthetic migrate` command.
- See [[features/service-control|Service Control]], [[features/workspace-switching|Workspace Discovery & Switching]], [[features/docker-compose-support|Docker & Compose Support]], and [[features/diff-review|Diff Review]] for detailed implementation specifications.
