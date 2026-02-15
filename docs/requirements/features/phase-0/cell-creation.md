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
