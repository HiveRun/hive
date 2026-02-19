# Cell Creation & Provisioning

- [d] Cell Creation & Provisioning #status/deferred #phase-0 #feature/advanced

> **Note**: This feature is **deferred** to focus on core functionality. See [[PR-SEQUENCE.md]] for current implementation path.
> 
> **Original Steps** (prepared but not implemented):
> - **Step 3**: Workspace & Cell Lifecycle → Now **Step 2: Basic Cell Management**
> - **Deferred**: Port Allocation System → Deferred to Phase 1A
> - **Deferred**: Service Management & Process Lifecycle → Deferred to Phase 1A  
> - **Deferred**: Provisioning Orchestration → Deferred to Phase 1A

## Goal
Handle the complete workflow of creating and provisioning cells from templates, including workspace setup, service initialization, and prompt assembly.

## Current Status: DEFERRED

This feature represents the **full provisioning orchestration** that was originally planned for Phase 0. It has been deferred to accelerate delivery of core functionality.

### What's Implemented Instead
- **Step 2**: Basic cell management (real database entities)
- **Step 3**: Git worktree integration (extends existing cells)
- **Step 4**: Agent integration (extends existing cells)

### When This Will Be Implemented
This comprehensive provisioning system will be implemented in **Phase 1A** after the core functionality path is complete and validated.

## Requirements

### Core Provisioning
- **Template Selection**: Allow users to browse and select from available cell templates defined in `hive.config.json`
- **Workspace Provisioning**: Create isolated git worktrees for each cell to prevent conflicts with the main workspace
- **Service Setup**: Initialize and configure required services (databases, APIs, etc.) as specified by the template
- **Port Allocation**: Dynamically allocate and manage ports to avoid conflicts between cells and the host system
- **Prompt Assembly**: Compose the initial agent prompt from template fragments, task brief, and runtime context
- **Environment Configuration**: Set up environment variables, dependencies, and toolchain access for the cell

## UX Requirements

### Template Selection Interface
- Display available templates with descriptions, requirements, and estimated resource usage
- Validate template compatibility with current workspace and user permissions
- Show template-specific configuration options (e.g., service choices, agent types)
- Provide clear feedback during template validation and selection process

### Provisioning Progress
- Show real-time progress during workspace creation and service initialization
- Display clear status indicators for each provisioning step
- Provide estimated completion times and current operation details
- Allow users to cancel provisioning operations with proper cleanup

### Error Feedback
- Surface provisioning errors with actionable guidance and recovery options
- Show specific failure points (template validation, workspace creation, service startup)
- Provide retry mechanisms for transient failures
- Display rollback status when provisioning fails and needs cleanup

## Implementation Details

### Template Selection Interface
- Display available templates with descriptions, requirements, and estimated resource usage
- Validate template compatibility with current workspace and user permissions
- Show template-specific configuration options (e.g., service choices, agent types)

### Workspace Provisioning
- Create git worktree in `.cells/<cell-id>/` using `git worktree add`
- Initialize cell-specific configuration files and directories
- Set up isolated node_modules, dependencies, and toolchain access
- Ensure proper permissions and ownership for the cell workspace

### Service Management
- Parse template service requirements and initialize accordingly
- Handle service dependencies and startup ordering
- Provide service health checks and status monitoring
- Manage service lifecycle (start, stop, restart) during cell operation

### Port Allocation Strategy
- Probe real host ports to avoid conflicts with running services
- Maintain port allocation registry to prevent duplicate assignments
- Support port ranges and specific port requirements from templates
- Handle port cleanup when cells are completed or archived

### Prompt Assembly Context
- Collect runtime information: allocated ports, service URLs, workspace paths
- Gather template-specific context and configuration
- Assemble base prompt with Hive overview and cell role
- Include task brief, constraints, and success criteria

## Integration Points
- **Template Definition System**: Provides template metadata and configuration schemas
- **Prompt Assembly Pipeline**: Handles the composition of agent prompts from multiple sources
- **Agent Orchestration Engine**: Receives the provisioned cell and assembled prompt for session initialization
- **Persistence Layer**: Stores cell metadata and provisioning state

## Testing Strategy
- Test template selection and validation workflows
- Verify workspace provisioning and isolation
- Test service initialization and health monitoring
- Validate port allocation and conflict resolution
- Test error handling and rollback mechanisms
- Performance testing for large repositories and complex templates

## Tasks
- [x] Surface template setup failures with detailed API/UI error context (2025-11-12)
- [x] Preserve failed cells and expose provisioning status for manual recovery (2025-11-12)
- [x] Allow cells to enter a spawning state while provisioning continues (HIVE-7, 2025-11-30)
- [/] Add cell archival flow that preserves the worktree for offline replay, disables runtime surfaces, adds a restore path for archived sessions, and exposes a cleanup path for deleting archived cells (HIVE-48, 2025-12-10)
- [x] Add true runtime E2E coverage for failed setup -> manual fix -> setup retry recovery flow
- [x] Add provisioning-phase timing instrumentation and template setup timeouts to prevent indefinite spawning stalls (2026-02-14)
- [x] Add `/api/cells/:id/timings` timeline endpoint with per-step creation/deletion durations (2026-02-14)
- [x] Add persistent `cell_timing_events` storage and `/api/cells/timings/global` filters so timing history remains queryable across all cells, including deleted cells (2026-02-14)
- [x] Add a dedicated global timings UI route + sidebar entry and route `/cells/$cellId/timings` redirects to filtered global view (2026-02-14)
- [x] Expand creation telemetry with granular `create_worktree`, record insert, and `ensure_services:*` setup/service-start timing steps so long setup hotspots are visible directly in timings views (2026-02-14)
- [x] Add explicit `create_request_received` start marker and nested `create_worktree:*` phase timings (git add/copy/tool-config/base-commit) so long pre-provisioning stalls are attributable (2026-02-14)
- [x] Keep local include-copy support for configured include patterns while speeding it up by copying static directory roots directly with ignore filters before file-level glob fallback (2026-02-14)
- [x] Keep include/ignore semantics explicit in the worktree copier so include patterns remain predictable and avoid hidden auto-expansion side effects (2026-02-14)
- [x] Use reflink-first copying for include-copy paths with automatic fallback to standard copy when filesystem support is unavailable, and surface reflink vs fallback counts in timing metadata (2026-02-14)
- [x] Shift worktree creation out of the synchronous `POST /api/cells` request and into the async provisioning workflow (`create_worktree` phase), so cell records are created immediately while workspace setup continues in spawning state (2026-02-15)
- [x] Expand timings UI details so copy-step metadata (copied roots/files, reflink vs fallback counts, pattern counts) is visible directly in the global timings table (2026-02-15)
- [x] Reduce "Loading templates..." latency by prefetching template queries from workspace actions and caching templates/OpenCode defaults server-side with short TTLs (2026-02-15)
- [x] Replace generic startup loading copy with a live provisioning checklist/timeline overlay in cell chat, driven by timing phases (`create_worktree`, `ensure_services`, `ensure_agent_session`, `mark_ready`) to improve perceived progress (2026-02-15)
- [x] Add an inline provisioning timeline/checklist to the cell header so users can always see completed vs remaining startup steps and the current sub-step while status is `spawning`/`pending` (2026-02-15)
- [x] Introduce a dedicated `/cells/$cellId/provisioning` route and redirect chat/base cell routes there until status is `ready`, route post-create navigation through `/cells/$cellId` so new cells land on provisioning instead of chat, and render the provisioning timeline as the primary full-page content on that route (2026-02-15)
- [x] Add `create_cell_record` as an explicit first checklist phase (before workspace creation) and harden live provisioning updates by keeping cell status SSE streams reconnectable and syncing detail query cache updates to avoid manual refreshes (2026-02-15)
- [x] Remove local clone assumptions from defaults by dropping non-essential include patterns, removing clone scripts from setup, and relying on upstream references or published packages instead (2026-02-15)
- [x] Harden delete cleanup so `close_agent_session`, terminal shutdown, service stop, and workspace removal are best-effort with explicit step timeouts, allowing `delete_cell_record` to complete and avoiding cells getting stuck undeletable when a cleanup sub-step hangs (2026-02-15)
- [x] Update Playwright + desktop WebDriver runtime tests to tolerate provisioning-route redirects, assert provisioning UI where appropriate, and wait for `ready` before terminal chat assertions (2026-02-15)
- [x] Fix post-create errant loading state by avoiding blocking route loaders on template prefetch, preserving sidebar cell data during refetch, and seeding new-cell cache entries immediately after create success (2026-02-15)
- [x] Remove remaining blocking route loaders from chat/provisioning entry so mid-provisioning reloads stay on in-route status UIs (not global pending overlays) and guard chat mounting until `ready` at render time (2026-02-15)
- [x] Persist a scoped React Query cache in IndexedDB (hydration-aware provider + cache bust key; only workspace/cell list+detail/template queries) so refreshes during provisioning can reuse recent data without persisting heavy timing/diff payloads (2026-02-15)
- [x] Eliminate global layout blocking during route transitions, add scoped non-blocking prefetch loaders on chat/provisioning subroutes, and slim `GET /api/cells/:id` via opt-in setup-log hydration (`includeSetupLog`) so initial cell/provisioning loads render immediately while still supporting explicit setup-log reads (2026-02-15)
- [x] Expand workspace sections by default on first load (while still honoring persisted sidebar expansion state afterwards) so users see cells immediately without manual workspace toggles (2026-02-15)
- [x] Address Codex PR #131 follow-up defects across provisioning retries, chat bootstrap gating, worktree include-copy edge cases, and request-log filtering so async provisioning remains correct under race conditions and heavy traffic (2026-02-15)
- [x] Prevent deleted cells from reappearing after immediate page reload by introducing a persisted `deleting` cell status on delete-init, filtering `deleting` rows out of list/detail APIs, evicting cell caches optimistically at mutation start, and forcing persisted cell list/detail queries stale-on-mount so hydration cannot pin pre-delete snapshots (2026-02-17)
- [x] Resolve remaining Codex PR #131 API/route-cache follow-ups by declaring `409` chat-terminal responses in route schemas and forcing fresh `/cells/$cellId` redirect decisions via server-revalidated cell detail fetches (2026-02-17)
- [x] Serialize provisioning retries per cell so overlapping retry/resume paths cannot launch concurrent workflows for the same cell, returning `409` when a duplicate retry request arrives mid-run (2026-02-17)
- [x] Address follow-up Codex race/accuracy regressions by auto-resuming interrupted `deleting` cells on startup, restoring failed resumed deletes to `error`, keeping static-root include-copy fast paths active when `.git` ignore globs are present, and computing timing run summaries from full untruncated step sets (2026-02-17)
- [x] Prevent global route-lock spinners during `/cells/$cellId` redirects by timing out fresh-detail prefetch fallback to cache, and auto-select the first available template when workspace defaults are absent so cell creation never opens with an empty template selection by default (2026-02-17)
- [x] Replace provisioning timeline polling with per-cell timing SSE subscriptions so checklist step updates land immediately when timing events are persisted, while still keeping global timings views in sync via targeted query invalidation (2026-02-17)
- [x] Add regression coverage for timing SSE delivery by testing `/api/cells/:id/timings/stream` event emission/filtering in server route tests and timing-stream query invalidation behavior in a web hook test (2026-02-17)
- [x] Stream create-worktree timing sub-steps live (no post-phase batching) and emit begin/progress/complete events for include-copy glob/file operations so provisioning UI advances during long worktree-copy windows (2026-02-17)
- [x] Prevent API starvation during expensive include-pattern globbing by running worktree include-copy glob matching in a subprocess (instead of in-process tinyglobby) so `/api/cells` and SSE endpoints stay responsive while long create-worktree scans run (2026-02-17)
- [x] Stabilize failed-state timeline rendering so completed phases do not show stale sub-step labels (e.g., `include copy files start`) and current-step resolution is derived from latest timing events, with regression tests covering checklist mapping behavior (2026-02-17)
- [x] Fix subprocess glob argument transport by passing include/ignore payloads via environment variables (instead of argv position parsing under `bun -e`), and add regression coverage ensuring include-pattern files (e.g. `.env`) are copied into new worktrees (2026-02-17)
- [x] Remove residual vendor-specific OpenCode assumptions by deleting `vendor` from template include-preview ignore defaults and simplifying agent guidance to reference the published SDK without local vendored clone caveats (2026-02-17)
- [x] Reduce include-copy glob scan cost in this workspace by expanding template ignore patterns to skip heavy generated/cache directories (`tmp`, `dist`, `build`, `.cache`, `coverage`, `src-tauri/target`, etc.) while preserving recursive `.env*` include behavior (2026-02-18)
- [x] Remove default template env/db include-copy patterns so new cell provisioning no longer performs recursive `.env*`/`*.db` glob scans by default; rely on explicit service env values in template configs for runtime setup (2026-02-18)
- [x] Restore `hive-dev` setup reliability after removing env include-copy by defining template-level `env.DATABASE_URL=local.db` so `bun setup`/db migration succeeds without requiring copied `.env*` files (2026-02-18)
- [x] Reintroduce env file propagation using rooted non-recursive include patterns (e.g. `./.env*`, `./apps/server/.env*`, `./apps/web/.env*`) so cells receive important env details without triggering expensive repo-wide `**/.env*` scans (2026-02-18)
- [x] Fix stale template/setup behavior after config edits by invalidating Hive config cache when `hive.config.json` mtime changes, ensuring provisioning uses latest template env/include settings without requiring manual server restarts (2026-02-18)
- [x] Improve setup diagnostics UI by showing configured include path patterns directly (instead of only derived static directories) so env propagation settings are visible when template setup fails (2026-02-18)
- [x] Resolve latest Codex lifecycle/SSE follow-ups by cancelling provisioning once cells enter `deleting`, emitting `cell_removed` tombstones on workspace streams, throttling timing invalidation/progress churn, and hardening template/worktree glob cache-runtime behavior for packaged builds (2026-02-18)
- [x] Patch post-review regressions by restoring immediate delete-step timeout rejection and making workspace status stream list updates upsert cells so delete-failure recoveries reappear without manual refetches (2026-02-18)
- [x] Reduce lifecycle route duplication by extracting a shared cached worktree-manager fetcher used by both bulk delete and startup delete-resume flows, keeping behavior aligned while shrinking hot-path route code (2026-02-18)
- [x] Extract delete-lifecycle orchestration (status transitions, timeout-guarded cleanup steps, timing emission wiring, workspace fallback cleanup) into a dedicated service module, then reuse it across single-delete, bulk-delete, and startup delete-resume flows to reduce route-file complexity while preserving behavior (2026-02-18)
- [x] Make provisioning checklist phase matching data-driven (exact/prefix matcher tables) and add table-driven alias coverage tests so timing sub-step name changes stay maintainable without branching sprawl (2026-02-18)
- [x] Reduce `cells.create` route-test duplication by adding shared request/seed helpers for create/delete/retry flows and provisioning-state fixtures, keeping assertions unchanged while shrinking repetitive setup payload blocks (2026-02-18)
- [x] Extract provisioning route status decisions (polling gate, timing-stream gate, status copy) into a shared utility with table-driven tests so provisioning page behavior stays consistent while reducing in-route branching code (2026-02-18)
- [x] Consolidate timing-history parsing/runs aggregation into a shared server service and reuse shared timing-query response helpers across global and per-cell endpoints, reducing duplicated timing-route logic while preserving response shape/ordering (2026-02-18)
- [x] Extract activity pagination/cursor parsing/query assembly into a shared server service and route-level page helper, reducing `/api/cells/:id/activity` handler branching while preserving cursor semantics and response payload shape (2026-02-18)
- [x] Fix provisioning retry initial-prompt gating by evaluating existing-session state before `ensure_agent_session` mutates `opencodeSessionId`, and add retry regression coverage to ensure prompts are sent when prior attempts never created a session (2026-02-18)
- [x] Move global timings UI to a distinct `/global-timings` route, keep `/timings` as a compatibility redirect, and route `/cells/$cellId/timings` to the same global view filtered by cell id (2026-02-18)
- [x] Separate global timings navigation from workspace listings by placing it in a distinct sidebar section (`Observability`) so workspace groups contain only workspace/cell navigation items (2026-02-18)
- [x] Guard setup retries and diff reads during delete lifecycle by rejecting `/:id/setup/retry` for `deleting` cells (409) and treating `deleting` as not-ready in diff request parsing, with regression coverage for both paths (2026-02-18)
- [x] Keep provisioning status polling active while the desktop WebDriver window is backgrounded by enabling `refetchIntervalInBackground` on the provisioning cell-detail query, so ready cells reliably auto-redirect back to chat and desktop smoke terminal checks stop stalling on the provisioning view (2026-02-18)
- [x] Harden desktop smoke chat-route readiness by polling `/api/cells/:id` during route wait, failing fast on `error`, and force-navigating back to `/chat` once status is `ready` so CI no longer stalls indefinitely on provisioning-only redirects (2026-02-18)
- [x] Prevent desktop smoke from entering terminal checks before provisioning actually reaches `ready` by requiring `/chat` route waits to confirm API `status=ready` (not URL alone), eliminating CI flakes where chat route rendered pre-ready loading UI without terminal controls (2026-02-18)
- [x] Make desktop chat smoke terminal readiness self-healing by reasserting `/chat` route + `status=ready` during terminal checks and failing fast on in-page chat load errors, preventing CI stalls when UI regresses back to provisioning/loading states after initial route wait (2026-02-18)
- [x] Fix cell-creation model override resolution so selected model IDs that differ from provider map keys still apply, with regression coverage for key-vs-id lookup behavior (2026-02-19)
- [x] Surface invalid cell-creation model overrides as explicit provisioning failures (no silent fallback) with clear provider/model diagnostics and regression coverage (2026-02-19)
- [x] Preserve selected model behavior for description-less cells by reusing provisioning overrides, seeding empty no-reply model metadata for brand-new sessions, and passing preferred model context to chat-terminal attach/restart paths, with regression coverage (2026-02-19)
- [x] Extend runtime E2E model assertions to validate selected model capture before the first user prompt, covering description-less session initialization paths end-to-end (2026-02-19)
- [x] Add server-level `/api/agents/sessions/byCell/:cellId` regression coverage to ensure selected model metadata is visible before any first user prompt for description-less cells (2026-02-19)
- [x] Make no-reply model seeding best-effort (warn instead of throw) so runtime startup still succeeds when `session.prompt` returns RPC errors or throws during initial model persistence (2026-02-19)
- [x] Restrict no-reply model seeding to newly created OpenCode sessions so transient message-history load failures on reused sessions cannot overwrite later user model selections (2026-02-19)
- [x] Harden desktop chat terminal checks against persistent no-terminal renders by adding bounded page reload recovery and live timeout diagnostics (dynamic last path/status/state), so CI failures surface actionable context and can recover from stuck chat hydration states (2026-02-18)
