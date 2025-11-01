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
- Record running service state (command, cwd, env, last-known status, pid if available). On startup, Synthetic should detect constructs marked active, probe each recorded PID with `kill -0` (does not terminate the process) to see which services survived, and mark any missing processes as `needs_resume`. A construct’s displayed status is derived from these state flags; if anything needs attention, the UI surfaces a “Resume construct” CTA (with optional granular controls).
- Agent sessions should persist transcripts/context so a fresh OpenCode session can be created after restart. Present a “Resume agent” button that replays the composed prompt before sending any new user input.
- Expose service control through both CLI/MCP tools (`list`, `stop`, `restart`, `resume`) so agents and humans can bounce services programmatically. Make it easy to copy the exact command/env that the supervisor uses (e.g., `synthetic services info <construct> <service>` prints the command) so users can run it manually if they really need to.

## Workspace Discovery & Switching
- On first launch, prompt the operator to choose a directory; if it contains a `synthetic.config.ts`, register it immediately.
- When a directory contains multiple subdirectories, scan only the immediate children for `synthetic.config.ts` and offer those as registrable workspaces.
- Persist registrations in the global workspace registry (e.g., `~/.synthetic/workspaces.json`) and surface all entries via the sidebar or command menu so switching is a single action.
- Switching workspaces updates the active repo context, constructs list, and services in-place; because Synthetic runs as a single instance, it can coordinate port assignments and avoid collisions automatically.
- Construct templates, histories, and artifacts remain isolated to their workspace; Synthetic never mixes constructs across projects.

## Docker & Compose Support
- For `type: "docker"` services, Synthetic runs `docker run` with the declared `image`, `command` (optional), `ports`, `env`, and `volumes`; port requests pick an open host port, map it to the declared container port, and expose the value through the configured env name. Volume paths support `${constructDir}` templating so persistent data lives alongside the construct workspace.
- Docker services use deterministic container names (`synthetic-{constructId}-{serviceName}`) so stop commands can be autogenerated when omitted.
- For `type: "compose"`, point to a Compose file (`composePath`) and optional service filter; Synthetic parses the file, injects templated variables (including generated ports/env vars), and starts the selected services with the same status tracking/ready detection pipeline.
- When Compose is involved, generated per-service shims expose the same lifecycle hooks (ready pattern, stop) to keep the UI consistent.

## File Changes & Diffs
- Each construct runs in a dedicated git worktree/branch cloned from the user’s chosen base revision. We record that base commit so diffs remain stable even if `main` advances.
- The agent (via OpenCode) writes directly to the worktree. Synthetic never auto-commits; instead we compute diffs on demand whenever the UI/API asks for them. Use `git diff --name-status <base>...` to build the file tree and only persist lightweight metadata (files touched, summary counts) so views always reflect the latest edits.
- For the per-file diff display we prefer semantic output: run [Difftastic](https://difftastic.wilfred.me.uk/) (`difft --background never <base> <rev>`) when it’s installed to produce syntax-aware hunks, and fall back to classic `git diff` output when it isn’t. Provide the structured hunk data in the response but do not cache full diff blobs in SQLite; recompute as needed so edits made outside the agent (e.g., user tweaks) appear immediately.
- After every agent turn we snapshot high-level metadata (files touched, summary stats) so the activity timeline can highlight what changed during that turn without storing the entire diff payload.
- Users and agents can ask to stage/revert files through CLI/MCP helpers (`synthetic diff stage <construct> <path>`, `synthetic diff discard <construct> <path>`). Staging simply marks the change as acknowledged; we still rely on git to hold the actual file content.
- When a construct is completed, we leave the branch in place so the user can create a commit/PR manually or let Synthetic open one in the future.
