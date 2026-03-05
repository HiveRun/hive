# Elixir Hard Cutover Migration Plan

## Execution Snapshot

- Current Step: Step 6 - Frontend contract migration (in progress).
- Next Action: switch web query factories/hooks to the new Elixir cell contracts (`/api/cells`, `/api/cells/:id`, `/api/cells/:id/activity`, `/api/cells/:id/timings`, `/api/cells/timings/global`, `/api/cells/:id/diff`) and remove Eden-only assumptions.
- Blockers: none.

## Step 1 Scaffold Baseline (Approved)

- Project name: `hive_server_elixir` (temporary migration app name while `apps/server` remains legacy TS).
- Include: `ash`, `ash_phoenix`, `ash_sqlite`, `ash_typescript`, `ash_oban`, `oban_web`, `ash_state_machine`, `ash_ai`, `usage_rules`, `tidewave`.
- Do not include for now: `ash_json_api`, full event sourcing extension, LiveView/Inertia auth/admin/UI scaffolds.
- Keep frontend contract generation through `ash_typescript`; avoid backend JSON:API surface area unless a concrete requirement appears.

## Status

- Owner: Hive core
- Scope: Single PR, hard cutover, no fallback backend
- Runtime target: local-first with one required Hive daemon

## Locked Decisions

- Frontend remains React in this migration.
- Backend moves to Elixir and Ash.
- OpenCode integration uses direct HTTP and SSE from Elixir via generated client.
- Local DB defaults to SQLite with `ash_sqlite`.
- Job engine uses Oban Lite (SQLite).
- Persist all OpenCode events initially.
- Hard cutover in this PR (TS backend removed before merge).
- Database strategy: one-time DB reset with automatic backup of legacy DB.

## Product Invariants (Must Remain True)

- Cell lifecycle remains correct (create -> provision -> ready or error -> delete).
- Retry and resume behavior works across restarts.
- Notification behavior remains reliable for status and input-required transitions.
- Terminal UX semantics remain stable (`ready`, `snapshot`, `data`, `exit`, `error`).
- Local UX remains simple (`hive` start/stop/info/logs still works).

## Non-Goals

- No LiveView or Inertia migration in this PR.
- No hosted runtime split in this PR.
- No bundled Postgres daemon in this PR.

## Step Plan

### Step 1: Scaffold Elixir Backend (`apps/hive_server_elixir`)

- Build Phoenix API-only app with Ash, AshSqlite, Reactor, and Oban Lite.
- Add Bun and Turbo wrapper scripts from root for dev/build/test.
- Done means:
  - Local server boots with `/health`.
  - SQLite file is created in local Hive state path.
  - Migrations run successfully.

### Step 1 Verification Evidence

- 2026-03-04 - `PORT=4311 DATABASE_PATH=/home/aureatus/dev/projects/hive/.hive/state/hive_server_elixir_dev.db mise x -C apps/hive_server_elixir -- mix ecto.migrate` completed and applied Oban migration.
- 2026-03-04 - SQLite file confirmed at `.hive/state/hive_server_elixir_dev.db` after migration.
- 2026-03-04 - `GET http://127.0.0.1:4311/health` returned `{"status":"ok"}` while server was running via `mix phx.server`.

### Step 2: OpenCode Contract + Client Generation

- Pin OpenCode OpenAPI spec in repo (`priv/opencode/openapi.json`).
- Generate Elixir client with `oapi_generator` into generated module namespace.
- Add thin adapter for retries, timeouts, and error normalization.
- Done means:
  - One sync call and one stream call work via adapter.
  - Client generation is reproducible in CI.

### Step 2 Verification Evidence

- 2026-03-04 - Pinned OpenCode OpenAPI spec at `apps/hive_server_elixir/priv/opencode/openapi.json` via `mix opencode.sync_spec`.
- 2026-03-04 - Added deterministic generation aliases in `apps/hive_server_elixir/mix.exs`:
  - `mix opencode.gen.client` (generate from pinned local spec)
  - `mix opencode.refresh` (fetch latest spec + regenerate)
- 2026-03-04 - Generated Elixir client modules with `oapi_generator` under `apps/hive_server_elixir/lib/hive_server_elixir/opencode/generated/`.
- 2026-03-04 - Added thin adapter and transport at:
  - `apps/hive_server_elixir/lib/hive_server_elixir/opencode/client.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/opencode/adapter.ex`
- 2026-03-04 - Verified one sync and one stream endpoint path through adapter with tests:
  - `apps/hive_server_elixir/test/hive_server_elixir/opencode/client_integration_test.exs`
  - `apps/hive_server_elixir/test/hive_server_elixir/opencode/adapter_test.exs`
  - `apps/hive_server_elixir/test/mix/tasks/opencode_sync_spec_test.exs`

### Step 3: Persist-All Event Ingest Pipeline

- Add append-only `agent_event_log`.
- Ingest all OpenCode events with normalized envelope:
  - `workspace_id`, `cell_id`, `session_id`, `seq`, `event_type`, `payload`, timestamps.
- Done means:
  - Events persist in order.
  - Session timeline query returns stable ordered output.

### Step 3 Verification Evidence (In Progress)

- 2026-03-05 - Added append-only `agent_event_log` migration with indexes and unique `(session_id, seq)` guard at `apps/hive_server_elixir/priv/repo/migrations/20260304201500_create_agent_event_log.exs`.
- 2026-03-05 - Replaced direct Ecto write/query helpers with Ash-backed persistence:
  - `apps/hive_server_elixir/lib/hive_server_elixir/opencode.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/opencode/agent_event.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/opencode/agent_event_log.ex`
- 2026-03-05 - Added persistence ordering/uniqueness coverage in `apps/hive_server_elixir/test/hive_server_elixir/opencode/agent_event_log_test.exs`.
- 2026-03-05 - Added stream ingest entrypoint at `apps/hive_server_elixir/lib/hive_server_elixir/opencode/event_ingest.ex` that pulls one OpenCode global event and persists it through the adapter.
- 2026-03-05 - Added deterministic per-session sequence assignment and session-id extraction fallback in `apps/hive_server_elixir/lib/hive_server_elixir/opencode/agent_event_log.ex`.
- 2026-03-05 - Added ingest flow coverage in `apps/hive_server_elixir/test/hive_server_elixir/opencode/event_ingest_test.exs` and verified `mix test` passes in `apps/hive_server_elixir`.
- 2026-03-05 - Added continuous ingest runtime + worker under app supervision:
  - `apps/hive_server_elixir/lib/hive_server_elixir/opencode/event_ingest_runtime.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/opencode/event_ingest_worker.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/application.ex`
- 2026-03-05 - Added runtime coverage for start/duplicate/stop semantics and continuous persistence at `apps/hive_server_elixir/test/hive_server_elixir/opencode/event_ingest_runtime_test.exs`.
- 2026-03-05 - Added lifecycle entrypoints for create/retry/resume/delete ingest control at `apps/hive_server_elixir/lib/hive_server_elixir/cells/lifecycle.ex`.
- 2026-03-05 - Added lifecycle hook coverage for start/restart/idempotent stop semantics at `apps/hive_server_elixir/test/hive_server_elixir/cells/lifecycle_test.exs`.
- 2026-03-05 - Added higher-level lifecycle integration coverage that verifies real event persistence across create -> retry restarts in `apps/hive_server_elixir/test/hive_server_elixir/cells/lifecycle_test.exs`.

### Step 4: Ash Resources + Reactor Flows

- Model core resources: workspace, cell, provisioning, service, agent session, activity, timing.
- Implement flows: create, retry, delete, resume with compensation.
- Done means:
  - Key lifecycle flows execute and recover correctly.
  - Flow failures emit meaningful domain error states.

### Step 4 Verification Evidence (In Progress)

- 2026-03-05 - Added first Reactor orchestration scaffold with compensation for ingest startup at `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/ensure_ingest_running.ex`.
- 2026-03-05 - Added Reactor step module with undo rollback to stop ingest workers at `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/steps/start_ingest_step.ex`.
- 2026-03-05 - Added higher-level Reactor workflow tests validating success path and compensation rollback at `apps/hive_server_elixir/test/hive_server_elixir/cells/reactors/ensure_ingest_running_test.exs`.
- 2026-03-05 - Added initial Ash Cells domain/resources and migration:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/workspace.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/cell.ex`
  - `apps/hive_server_elixir/priv/repo/migrations/20260305200000_create_workspaces_and_cells.exs`
- 2026-03-05 - Added `CreateCell` Reactor flow that creates a cell record, starts ingest, and rolls back ingest on downstream failure at `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/create_cell.ex`.
- 2026-03-05 - Added high-level `CreateCell` Reactor integration tests (success + compensation rollback) at `apps/hive_server_elixir/test/hive_server_elixir/cells/reactors/create_cell_test.exs`.
- 2026-03-05 - Wired Reactor flows into domain runtime entrypoints (`create_cell/retry_cell/resume_cell/delete_cell`) at `apps/hive_server_elixir/lib/hive_server_elixir/cells.ex`.
- 2026-03-05 - Added `RetryCell`, `ResumeCell`, and `DeleteCell` Reactor flows with compensation-aware ingest step modules:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/retry_cell.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/resume_cell.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/delete_cell.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/steps/retry_ingest_step.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/steps/resume_ingest_step.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/steps/stop_ingest_step.ex`
- 2026-03-05 - Added high-level lifecycle Reactor coverage for retry/resume/delete paths (including compensation rollback assertions) at `apps/hive_server_elixir/test/hive_server_elixir/cells/reactors/cell_lifecycle_reactors_test.exs`.
- 2026-03-05 - Wired Reactor-backed cell lifecycle flows into Phoenix API routes/controller:
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
- 2026-03-05 - Added API-level failure-state coverage (invalid id, missing resource, lifecycle failure payloads, and delete cleanup) at `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`.
- 2026-03-05 - Modeled remaining Step 4 Ash resources (`provisioning`, `service`, `agent session`, `activity`, `timing`) and added persistence tables:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/provisioning.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/service.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/agent_session.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/activity.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/timing.ex`
  - `apps/hive_server_elixir/priv/repo/migrations/20260305213000_create_cell_lifecycle_resources.exs`
- 2026-03-05 - Added `/api/cells/:id/resources` failure-state contract exposing modeled resource snapshots and derived lifecycle issues at:
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
- 2026-03-05 - Added high-level coverage for modeled resources and API failure-state snapshots at:
  - `apps/hive_server_elixir/test/hive_server_elixir/cells/resources_test.exs`
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`

### Step 5: Realtime + Terminal Transport

- Implement SSE/WS streams used by frontend.
- Preserve terminal event semantics (`ready/snapshot/data/exit/error`).
- Done means:
  - Terminal and stream hooks work unchanged at behavior level.
  - Reconnect paths remain stable.

### Step 5 Verification Evidence (Completed)

- 2026-03-05 - Added workspace cell SSE stream endpoint with `ready`/`cell`/`snapshot` framing and PubSub-driven `cell_removed` updates:
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
- 2026-03-05 - Added dedicated workspace stream PubSub broadcaster for cell status/removal events:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/events.ex`
- 2026-03-05 - Added high-level stream + event coverage:
  - `apps/hive_server_elixir/test/hive_server_elixir/cells/events_test.exs`
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
- 2026-03-05 - Added cell timing SSE stream parity (`/api/cells/:id/timings/stream`) with `ready`/`timing`/`snapshot` framing:
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
- 2026-03-05 - Extended event broadcaster with timing channels and validated timing stream snapshots at:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/events.ex`
  - `apps/hive_server_elixir/test/hive_server_elixir/cells/events_test.exs`
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
- 2026-03-05 - Added setup terminal SSE stream parity starter with `ready`/`snapshot` baseline and PubSub-backed `data`/`exit` events:
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
- 2026-03-05 - Added setup terminal event broadcaster coverage and API-level stream checks at:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/events.ex`
  - `apps/hive_server_elixir/test/hive_server_elixir/cells/events_test.exs`
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
- 2026-03-05 - Extended terminal transport parity with setup/service/chat terminal routes:
  - Added service stream/input/resize and chat stream/input/resize/restart routes in `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`.
  - Added controller handlers with SSE framing (`ready`/`snapshot`/`data`/`exit`/`error`) and request validation in `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`.
- 2026-03-05 - Added supervised in-memory terminal runtime to back high-level transport behavior:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/terminal_runtime.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/application.ex`
- 2026-03-05 - Extended terminal event broadcaster channels and coverage for setup/service/chat data/exit/error events:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/events.ex`
  - `apps/hive_server_elixir/test/hive_server_elixir/cells/events_test.exs`
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
- 2026-03-05 - Wired setup terminal lifecycle events to runtime lifecycle hooks so create/retry/resume/delete paths now emit setup/chat stream state transitions:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/lifecycle.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/terminal_events.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/terminal_runtime.ex`
- 2026-03-05 - Connected OpenCode ingest worker events to chat terminal stream projections (message deltas/updates, session errors, PTY exits):
  - `apps/hive_server_elixir/lib/hive_server_elixir/opencode/event_ingest_runtime.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/opencode/event_ingest_worker.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/terminal_events.ex`
- 2026-03-05 - Added high-level verification for terminal lifecycle + projection behavior:
  - `apps/hive_server_elixir/test/hive_server_elixir/cells/terminal_events_test.exs`
  - `apps/hive_server_elixir/test/hive_server_elixir/opencode/event_ingest_runtime_test.exs`
- 2026-03-05 - Added websocket terminal parity starter using Phoenix sockets/channels:
  - Added socket endpoint and channel wiring in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/endpoint.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/terminal_socket.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/channels/terminal_channel.ex`
  - Added channel-level terminal event coverage in:
    - `apps/hive_server_elixir/test/support/channel_case.ex`
    - `apps/hive_server_elixir/test/hive_server_elixir_web/channels/terminal_channel_test.exs`
- 2026-03-05 - Replaced service terminal in-memory placeholder flow with supervised process runtime execution:
  - Added service process runtime supervisor that spawns commands and emits service terminal `data`/`exit` events in:
    - `apps/hive_server_elixir/lib/hive_server_elixir/cells/service_runtime.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir/application.ex`
  - Wired SSE + websocket service terminal paths to ensure/write through runtime-backed service processes in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/channels/terminal_channel.ex`
  - Added cleanup integration for cell teardown in:
    - `apps/hive_server_elixir/lib/hive_server_elixir/cells/terminal_events.ex`
  - Added high-level runtime verification coverage in:
    - `apps/hive_server_elixir/test/hive_server_elixir/cells/service_runtime_test.exs`
- 2026-03-05 - Added service lifecycle control endpoints and persisted runtime status/pid projection:
  - Added service control API routes (`start`, `stop`, `restart`, and cell-wide `services/restart`) in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - Added runtime-backed service start/stop/restart handling with Ash status/pid updates in:
    - `apps/hive_server_elixir/lib/hive_server_elixir/cells/service_runtime.ex`
  - Exposed service `pid`/`port` in serialized resource snapshots in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - Added API-level and runtime coverage for service lifecycle controls in:
    - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
    - `apps/hive_server_elixir/test/hive_server_elixir/cells/service_runtime_test.exs`
- 2026-03-05 - Completed service payload parity slice for runtime-backed service APIs:
  - Added `/api/cells/:id/services` with TS-compatible fields (`recentLogs`, `totalLogLines`, `hasMoreLogs`, `processAlive`, `portReachable`, `url`) in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - Added runtime status introspection and safer persistence handling in:
    - `apps/hive_server_elixir/lib/hive_server_elixir/cells/service_runtime.ex`
  - Added audit-header propagation (`x-hive-source`, `x-hive-tool`, `x-hive-audit-event`, `x-hive-service-name`) to service lifecycle activity events in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - Added high-level API coverage for service list payloads and audit metadata parity in:
    - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
- 2026-03-05 - Added service stream and bulk lifecycle route parity used by existing React hooks/mutations:
  - Added service SSE stream endpoint (`/api/cells/:id/services/stream`) with `ready`/`service`/`snapshot` framing plus heartbeat updates in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - Added cell-wide service start/stop endpoints (`/api/cells/:id/services/start`, `/api/cells/:id/services/stop`) in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - Added PubSub-backed service update channel and runtime broadcasts so service stream payloads refresh on lifecycle transitions in:
    - `apps/hive_server_elixir/lib/hive_server_elixir/cells/events.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir/cells/service_runtime.ex`
  - Added high-level verification for service stream framing, bulk start/stop routes, and service update events in:
    - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
    - `apps/hive_server_elixir/test/hive_server_elixir/cells/events_test.exs`

### Step 6: Frontend Contract Migration (React)

- Remove Eden dependency path.
- Replace with generated TS client/types from new backend contracts.
- Rewrite query factories and stream hooks as needed.
- Done means:
  - Web app runs fully against Elixir backend.
  - No frontend imports from `@hive/server`.

### Step 6 Verification Evidence (In Progress)

- 2026-03-05 - Added core cell query contract routes used by existing React query factories:
  - `GET /api/cells` (workspace-scoped list)
  - `GET /api/cells/:id` (detail + optional setup log)
  - `GET /api/cells/:id/activity` (cursor/limit/types pagination)
  - `GET /api/cells/:id/timings` and `GET /api/cells/timings/global` (step/run summaries)
  - `GET /api/cells/:id/diff` (contract-compatible diff payload scaffold)
  - `DELETE /api/cells` (bulk deletion response with `deletedIds`)
  - Routes and handlers in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
- 2026-03-05 - Expanded cell API serialization contract parity for list/detail payloads (`name`, `templateId`, workspace paths, opencode fields, lifecycle metadata) in:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/cell.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/create_cell.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells.ex`
  - `apps/hive_server_elixir/priv/repo/migrations/20260305230000_add_cell_contract_fields.exs`
- 2026-03-05 - Added high-level API coverage for the new list/detail/activity/timings/diff/bulk-delete contracts in:
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
- 2026-03-05 - Replaced the placeholder diff payload with git-backed diff parity (workspace/branch validation, summary files, optional detail payloads with before/after content and patch text) in:
  - `apps/hive_server_elixir/lib/hive_server_elixir/cells/diff.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`

### Step 7: CLI, E2E, Desktop Runtime Cutover

- Update CLI runtime start/stop to launch Elixir backend.
- Update E2E and desktop runners to target Elixir server.
- Done means:
  - `bun run test:e2e` passes.
  - `bun run test:e2e:desktop` passes.
  - `hive` CLI daemon lifecycle works end-to-end.

### Step 8: Packaging, Installer, CI

- Package Elixir release artifacts in distribution pipeline.
- Update installer/runtime env assumptions.
- Add Elixir checks/tests to CI gates.
- Done means:
  - Installer artifacts boot correctly.
  - CI passes with new backend.

### Step 9: Hard Cutover Cleanup

- Remove TS backend code and dependencies.
- Remove remaining `@hive/server` references.
- Update docs/prompts to new architecture.
- Done means:
  - No runtime path to TS backend remains.
  - Repo docs and scripts match new architecture.

## Database Reset Strategy (Approved)

- On first boot of new backend:
  - Detect legacy schema.
  - Move legacy DB to backup path with timestamp.
  - Initialize fresh Ash DB.
- User messaging:
  - Print explicit migration notice and backup path.
  - Explain reset rationale and future import plan.
- Follow-up (optional):
  - Add importer for selected legacy metadata.

## Risk Register

- PTY parity and terminal protocol drift.
- SQLite write pressure from persist-all events.
- CLI/runtime packaging drift during backend switch.
- E2E contract churn while frontend data layer migrates.

## Verification Matrix

- Dev startup (`hive`, `bun run dev`).
- Health checks and API smoke tests.
- Web critical flows (cell create/provision/chat/delete).
- Terminal behavior (input/resize/restart/exit).
- Session/notification flow correctness.
- E2E + desktop E2E full pass.
- Distribution install + start + stop + logs.

## Change Log

- 2026-03-03 - Initial migration plan created.
- 2026-03-03 - DB reset strategy approved.
- 2026-03-03 - Scaffold generated at `apps/hive_server_elixir` with approved dependency baseline.
- 2026-03-04 - Root setup/dev/test/check scripts now invoke Elixir scaffold commands.
- 2026-03-04 - Added isolated dev port allocation (`scripts/dev/dev-ports.ts`) and wired combined web+elixir startup script.
- 2026-03-04 - Added Elixir `/health` endpoint and moved Ash TypeScript RPC endpoints onto the API pipeline.
- 2026-03-04 - Dev startup script now provisions `.hive/state` and passes `DATABASE_PATH` so Elixir dev DB lives under local Hive state.
- 2026-03-04 - Verified Step 1 done criteria end-to-end (`/health`, local sqlite path under `.hive/state`, and successful migrations).
- 2026-03-04 - Completed Step 2 scaffolding: pinned OpenCode OpenAPI spec, generated Elixir client modules, added adapter/transport, and added coverage for sync + stream call paths.
- 2026-03-05 - Began Step 3 persistence: added append-only event log migration + Ash domain/resource + ordered timeline query coverage.
- 2026-03-05 - Added OpenCode ingest persistence hooks in adapter and introduced continuous ingest runtime/worker with tests.
- 2026-03-05 - Added cell lifecycle ingest hooks (`on_cell_create/retry/resume/delete`) and tests ahead of Reactor flow integration.
- 2026-03-05 - Added higher-level lifecycle ingest integration tests and started Step 4 with a Reactor scaffold + compensation rollback tests.
- 2026-03-05 - Added Reactor-backed cell lifecycle variants (create/retry/resume/delete), wired domain entrypoints, and expanded high-level compensation tests.
- 2026-03-05 - Exposed Reactor-backed cell lifecycle flows via Phoenix API endpoints and added API-level failure-state assertions.
- 2026-03-05 - Added Elixir service stream + bulk service lifecycle parity endpoints to unblock Step 6 frontend contract migration work.
- 2026-03-05 - Added core Elixir cell query contracts (list/detail/activity/timings/diff/bulk-delete) and expanded cell payload fields for Step 6 frontend migration readiness.
- 2026-03-05 - Added git-backed Elixir `/api/cells/:id/diff` parity behavior (status gating, branch validation, summary/details payloads) with high-level controller coverage.
