# Elixir Hard Cutover Migration Plan

## Execution Snapshot

- Current Step: Step 9 - Hard Cutover Cleanup (in progress).
- Next Action: finish doc/prompt cleanup and final validation for the Elixir-only runtime path.
- Blockers: none for local runtime cutover; follow-up release confirmation is still useful on macOS and Windows runners.

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

### Step 6 Verification Evidence (Completed)

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
- 2026-03-05 - Expanded `/api/cells/:id/resources` toward TS contract parity so resource dashboards can consume Elixir responses without frontend changes:
  - Added resource summary builder with contract fields (`cellId`, `sampledAt`, `processCount`, tracked counts, process list, optional history/averages/rollups) in:
    - `apps/hive_server_elixir/lib/hive_server_elixir/cells/resource_summary.ex`
  - Wired resources controller response to include summary contract payload (while preserving current diagnostic `resources` + `failures` fields) and added high-level API coverage in:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
    - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
- 2026-03-05 - Added service resource payload parity for `includeResources=true` so service views receive resource contract keys (`cpuPercent`, `rssBytes`, `resourceSampledAt`, `resourceUnavailableReason`) in:
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/cells_controller_test.exs`
- 2026-03-05 - Added workspace management route parity (`/api/workspaces`, `/api/workspaces/browse`, register/activate/delete) to satisfy frontend workspace query contracts in:
  - `apps/hive_server_elixir/lib/hive_server_elixir/workspaces.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/workspaces_controller.ex`
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/workspaces_controller_test.exs`
- 2026-03-05 - Added template route parity (`/api/templates`, `/api/templates/:id`) with workspace resolution, `hive.config.json` loading, defaults/startMode shaping, and optional OpenCode agent defaults in:
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/templates_controller.ex`
  - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/templates_controller_test.exs`
- 2026-03-06 - Added agent/model query route parity used by frontend session and model selectors:
  - `GET /api/agents/models` (workspace-scoped provider catalog + defaults)
  - `GET /api/agents/sessions/:id/models` (session-scoped provider catalog)
  - `GET /api/agents/sessions/byCell/:cellId` (cell-scoped session payload)
  - Routes, contract shaping, and workspace/session resolution in:
    - `apps/hive_server_elixir/lib/hive_server_elixir/agents.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/agents_controller.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
  - Added high-level API coverage (success + error payloads) in:
    - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/agents_controller_test.exs`
    - `apps/hive_server_elixir/test/support/opencode_test_client.ex`
- 2026-03-06 - Expanded agent session route parity for monitor + E2E contracts:
  - `GET /api/agents/sessions/:id/messages` (normalized message list)
  - `GET /api/agents/sessions/:id/events` (SSE status/mode/input_required + heartbeat)
  - Added session fallback behavior when `cell_agent_sessions` rows are missing by resolving session IDs from OpenCode event log / cell contract fields.
  - Implementation in:
    - `apps/hive_server_elixir/lib/hive_server_elixir/agents.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/agents_controller.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
  - Added high-level API coverage in:
    - `apps/hive_server_elixir/test/hive_server_elixir_web/controllers/agents_controller_test.exs`
    - `apps/hive_server_elixir/test/support/opencode_test_client.ex`
- 2026-03-06 - Added explicit agent session mode mutation contract to support backend-driven mode transitions during Elixir cutover:
  - `POST /api/agents/sessions/:id/mode` (mode update to `plan`/`build`)
  - Added controller/domain wiring in:
    - `apps/hive_server_elixir/lib/hive_server_elixir/agents.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/agents_controller.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex`
- 2026-03-06 - Added cell create-mode parity for session/provisioning initialization so `/api/agents/sessions/byCell/:cellId` returns stable `startMode`/`currentMode` even before OpenCode event fallback paths:
  - Parse and forward `startMode` in create endpoint:
    - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
  - Persist initial lifecycle/session records in create reactor:
    - `apps/hive_server_elixir/lib/hive_server_elixir/cells/reactors/create_cell.ex`
    - `apps/hive_server_elixir/lib/hive_server_elixir/cells.ex`
- 2026-03-06 - Added API CORS + OPTIONS preflight handling for cross-origin web dev/E2E traffic so Vite-hosted frontend requests can reach Elixir APIs without browser `ERR_FAILED`/preflight 404 failures:
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/plugs/cors.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/endpoint.ex`

### Step 7: CLI, E2E, Desktop Runtime Cutover

- Update CLI runtime start/stop to launch Elixir backend.
- Update E2E and desktop runners to target Elixir server.
- Done means:
  - `bun run test:e2e` passes.
  - `bun run test:e2e:desktop` passes.
  - `hive` CLI daemon lifecycle works end-to-end.
- Prep audit (2026-03-06): both E2E runners still boot the legacy TypeScript server process (`apps/server`) and need explicit cutover wiring to `apps/hive_server_elixir` runtime:
  - `apps/e2e/src/runtime/e2e-runner.ts`
  - `apps/e2e-desktop/src/runtime/desktop-e2e-runner.ts`
- 2026-03-06 - Wired both E2E runners to boot the Elixir backend directly via `mix phx.server` (`mise x -C . -- mix phx.server`) and pass `DATABASE_PATH` for isolated run databases:
  - `apps/e2e/src/runtime/e2e-runner.ts`
  - `apps/e2e-desktop/src/runtime/desktop-e2e-runner.ts`
- 2026-03-06 - Hardened Elixir-backed E2E runner startup by running `mix ecto.migrate` before boot and switching runner server env to production-safe runtime vars (`MIX_ENV=prod`, `DATABASE_PATH`, `SECRET_KEY_BASE`) to avoid dev codegen checks during suite startup:
  - `apps/e2e/src/runtime/e2e-runner.ts`
  - `apps/e2e-desktop/src/runtime/desktop-e2e-runner.ts`
- 2026-03-06 - Added explicit workspace bootstrap in runners (register + activate primary workspace; register secondary workspace for workspace-switching coverage) to restore preconditions previously handled by legacy runtime assumptions:
  - `apps/e2e/src/runtime/e2e-runner.ts`
  - `apps/e2e-desktop/src/runtime/desktop-e2e-runner.ts`
- 2026-03-06 - Verification runs after runner cutover:
  - `bun run test:e2e:desktop:spec apps/e2e-desktop/specs/smoke-launch.spec.ts` passed.
  - `bun run test:e2e:spec apps/e2e/specs/plan-mode.e2e.ts` passed after migrating plan-mode verification to backend session-mode contract (`POST /api/agents/sessions/:id/mode`) and initializing session/provisioning start mode on create.
  - `bun run test:e2e:spec apps/e2e/specs/workspace-switching.e2e.ts` passed after workspace bootstrap + API CORS/preflight parity updates.
  - `bun run test:e2e` currently reports 3 passing / 8 failing specs; remaining failures cluster around terminal websocket route parity, service runtime lifecycle parity, and setup retry orchestration.
- 2026-03-07 - Completed frontend terminal websocket transport cutover to Phoenix channel topics for chat/setup/service terminals and updated stream-terminal consumers to use the shared terminal socket abstraction:
  - `apps/web/src/lib/terminal-websocket.ts`
  - `apps/web/src/components/cell-terminal.tsx`
  - `apps/web/src/components/pty-stream-terminal.tsx`
- 2026-03-07 - Fixed chat terminal restart parity to avoid immediate `exit` state regression after restart by removing synthetic exit publication from restart handlers:
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/channels/terminal_channel.ex`
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/cells_controller.ex`
- 2026-03-07 - Hardened session model/provider parity fallback so `/api/agents/sessions/byCell/:cellId` resolves defaults from timeline or workspace `@opencode.json`/`opencode.json` when persisted session fields are unset:
  - `apps/hive_server_elixir/lib/hive_server_elixir/agents.ex`
- 2026-03-07 - Updated E2E readiness/recovery specs for Elixir-backed terminal surfaces (terminal readiness probe and chat-terminal recovery fallback when PID is unavailable):
  - `apps/e2e/src/test-helpers.ts`
  - `apps/e2e/specs/cell-chat.e2e.ts`
  - `apps/e2e/specs/chat-terminal-recovery.e2e.ts`
- 2026-03-07 - Verification runs after terminal transport + restart fixes:
  - `bun run test:e2e:spec apps/e2e/specs/terminal-route.e2e.ts` passed.
  - `bun run test:e2e:spec apps/e2e/specs/terminal-refresh.e2e.ts` passed.
  - `bun run test:e2e:spec apps/e2e/specs/chat-terminal-recovery.e2e.ts` passed.
  - `bun run test:e2e:spec apps/e2e/specs/setup-retry.e2e.ts` passed after adding cell workspace snapshots + template setup execution.
  - `bun run test:e2e:spec apps/e2e/specs/cell-deletion-cleanup.e2e.ts` passed after template-defined service creation/startup was restored.
  - `bun run test:e2e:spec apps/e2e/specs/services.e2e.ts` passed after restoring service stream routing/resource sampling/activity logging parity.
  - `bun run test:e2e:spec apps/e2e/specs/cell-chat.e2e.ts` passed after session-message transport failures now fall back to terminal-backed messages.
  - `mix precommit` passed (110 tests, 0 failures).
  - `bun run test:e2e` passed end-to-end on the Elixir backend.
  - `xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" bun run test:e2e:desktop` passed headlessly on the Elixir backend.
  - CLI lifecycle verified with compiled `packages/cli/hive` against the Elixir runtime:
    - `./hive info` reported stopped/running/stopped transitions correctly.
    - `./hive` launched the daemon in the background.
    - `curl http://localhost:4310/health` returned `{"status":"ok"}` while running.
    - `timeout 3s ./hive logs` streamed Elixir boot/health logs.
    - `./hive stop` terminated the daemon and `/health` stopped responding.

Step 7 done criteria are now satisfied locally:
- `bun run test:e2e` passes.
- `bun run test:e2e:desktop` passes headlessly.
- `hive` CLI daemon lifecycle works end-to-end on the Elixir runtime.

### Step 8: Packaging, Installer, CI

- Package Elixir release artifacts in distribution pipeline.
- Update installer/runtime env assumptions.
- Add Elixir checks/tests to CI gates.
- Done means:
  - Installer artifacts boot correctly.
  - CI passes with new backend.

- 2026-03-07 - Packaged a real Elixir release into installer artifacts and updated runtime/install assumptions:
  - `scripts/distribution/build.ts` now builds `mix assets.deploy` + `mix release` and copies `_build/prod/rel/hive_server_elixir` into the installer payload.
  - `packages/cli/src/cli.ts` now prefers the bundled Elixir release executable and only falls back to `mise x ... mix phx.server` when no packaged release is present.
  - `scripts/install.sh` now writes `HIVE_SERVER_RELEASE_ROOT` instead of legacy migration-path config.
  - `apps/hive_server_elixir/lib/hive_server_elixir_web/plugs/static_assets.ex`, `apps/hive_server_elixir/lib/hive_server_elixir_web/controllers/web_app_controller.ex`, and `apps/hive_server_elixir/lib/hive_server_elixir_web/router.ex` now serve the bundled SPA from `HIVE_WEB_DIST` with index fallback for installed releases.
  - `README.md` updated to reflect release-based installer contents/config.
- 2026-03-07 - Local distribution verification passed:
  - `bun run build:installer` produced a tarball with bundled Elixir release.
  - `bash scripts/install.sh` with `HIVE_INSTALL_URL=file://...` installed successfully into a temporary `HIVE_HOME`.
  - Installed `hive` loaded `current/hive.env`, launched the bundled release on a custom port, served `index.html` from bundled `public/`, answered `/health`, streamed logs, and stopped cleanly.
- 2026-03-07 - CI/release automation updated for the bundled Elixir release path:
  - `scripts/distribution/build.ts` now resolves `mix` directly when available and only falls back to `mise`, plus it runs `mix deps.get` and `mix release --overwrite` for clean CI builds.
  - `scripts/distribution/check-distribution.ts` now boots the installed release on a dedicated port, verifies `/health`, verifies the bundled SPA shell at `/`, and confirms `hive stop` shuts the daemon down.
  - `.github/workflows/ci.yml` desktop installer gate and `.github/workflows/release-publish.yml` now install Erlang/Elixir via `erlef/setup-beam@v1` before invoking `bun run build:installer`.

### Step 9: Hard Cutover Cleanup

- Remove TS backend code and dependencies.
- Remove remaining `@hive/server` references.
- Update docs/prompts to new architecture.
- Done means:
  - No runtime path to TS backend remains.
  - Repo docs and scripts match new architecture.

- 2026-03-07 - Removed the remaining active TypeScript backend dependency paths from the current runtime/tooling surface:
  - Moved shared Hive config schema/types out of `apps/server` into `packages/config/src/hive-config-schema.ts` so config generation no longer imports the legacy backend.
  - Replaced the web app's `@hive/server` Eden dependency with a local fetch-backed `@/lib/rpc` wrapper targeting the Elixir API routes.
  - Updated root scripts and generated config defaults to point at `apps/hive_server_elixir` for dev/database operations.
  - Left dormant `apps/server` source in place for now, but it is no longer part of the active runtime/dependency path.
- 2026-03-07 - Updated README and Ruler prompt sources to describe Hive as an Elixir/Ash backend with Elixir-first runtime/testing commands.
- 2026-03-07 - Hardened the Elixir runtime's local-only perimeter and cleaned up transport/controller contracts:
  - Added shared loopback/origin checks in `apps/hive_server_elixir/lib/hive_server_elixir_web/local_access.ex` and enforced them for API + stream pipelines.
  - Defaulted backend binding back to loopback unless `HIVE_ALLOW_REMOTE_ACCESS=1` is set, while keeping explicit `CORS_ORIGINS` / `CORS_ORIGIN` overrides available.
  - Switched terminal socket origin handling to endpoint-configured checks and extracted shared terminal/cell serializers to reduce controller/channel drift.
- 2026-03-07 - Tightened runtime persistence invariants needed for the hard cutover:
  - Persisted active workspace selection via `workspaces.last_opened_at` so restarts keep the last-opened workspace active.
  - Added bounded terminal output retention in `TerminalRuntime` to avoid unbounded append growth while preserving stream order for readers.
  - Added session-scoped event sequence allocation storage so persisted OpenCode event logs keep stable ordering under concurrent writes.
- 2026-03-07 - Tightened `Cell.status` handling by moving the resource to a dedicated Ash enum helper with compatibility coverage for legacy `paused` and `failed` states.
- 2026-03-08 - Continued Phase C lifecycle tightening by introducing explicit Ash lifecycle actions for `Cell.status`, normalizing statuses down to `provisioning | ready | stopped | error | deleting`, migrating legacy stored values (`spawning`/`pending` -> `provisioning`, `paused` -> `stopped`, `failed` -> `error`), and updating runtime/frontend consumers to use the simplified status model.
- 2026-03-08 - Moved `Service` and `Provisioning` lifecycle bookkeeping further into Ash:
  - `Service.status` is now an Ash enum with explicit `mark_running`, `mark_stopped`, and `mark_error` actions, plus a migration that normalizes legacy `pending` rows to `stopped`.
  - `ServiceRuntime`, service snapshot reconciliation, and resource summaries now share the Ash-owned lifecycle semantics instead of mutating free-form status strings.
  - `Provisioning` attempt tracking now uses explicit begin/finish actions so attempt counters and timestamps are no longer assembled ad hoc inside the cell reactors.
- 2026-03-08 - Followed up on service read-time self-healing by adding an explicit `Service.reconcile_runtime_state` Ash action and routing service snapshot/resource-summary reads through a shared reconciliation helper before serialization.
- 2026-03-08 - Added a first-class `TerminalSession` Ash resource so setup/chat/service terminal metadata (kind, runtime session id, rows/cols, status) is persisted and typed through Ash even though websocket/SSE byte streaming remains a custom Phoenix transport concern.
- 2026-03-08 - Added an AshOban-backed `Service.reconcile_runtime_inventory` scheduled action so runtime drift can be reconciled periodically through an explicit Ash action instead of only on demand during reads.
- 2026-03-08 - Tightened `AgentSession` lifecycle writes around explicit Ash actions by replacing the broad primary update with `begin_session`, `set_mode`, `sync_runtime_details`, and `record_error`, and by routing mode changes through the new `set_mode` action so session mode semantics live in the resource boundary.
- 2026-03-08 - Added explicit AgentSession projection hooks in ingest/runtime paths so OpenCode events and retry/resume flows now create/sync persisted session rows through `begin_session`, `sync_runtime_details`, `set_mode`, and `record_error` instead of leaving session detail/error state implicit in event timelines alone.
- 2026-03-08 - Extracted AgentSession read-model derivation into a dedicated `Cells.AgentSessionRead` helper so session context lookup, timeline-derived status/mode/model projection, and cell/session fallback resolution no longer live inside the message-fetch adapter module.
- 2026-03-08 - Kept session message reads transport-backed for now, but extracted the OpenCode fetch + terminal fallback path into a dedicated `SessionMessagesLoader` so volatile message transport remains separate from the Ash-owned session read model.
- 2026-03-08 - Moved setup-attempt bookkeeping behind explicit `Cell` lifecycle actions by adding `prepare_setup_attempt` and `finalize_setup_attempt`, so create/retry/resume reactors now delegate provisioning attempt rows, session resume flags, and setup completion timestamps to Ash instead of mutating `Cell`, `Provisioning`, and `AgentSession` separately.
- 2026-03-09 - Tightened retry/resume failure handling so ingest restart errors now reach setup terminal streams, and resume/retry compensation closes started setup attempts back through `Cell.finalize_setup_attempt` instead of leaving provisioning bookkeeping stuck in-progress after failed restarts or post-ingest checks.
- 2026-03-11 - Continued Step 9 bounded-context cleanup inside `apps/hive_server_elixir` without changing runtime behavior:
  - Consolidated workspace browse/path/config ownership behind `Workspaces.PathPolicy`, `Workspaces.Browse`, and shared `Cells.WorkspaceConfig` helpers so workspace activation, browse roots, and workspace-level defaults stop duplicating policy across controllers, templates, and agent reads.
  - Trimmed remaining top-level facades by extracting shared `AshActionResult`, typed-controller request helpers, cell error rendering, template payload serialization, and `Cells.CellCommands`, while letting `Cell` and `Service` own more of their payload and lifecycle command wiring directly.
  - Kept OpenCode transport concerns separated from persistence by moving fetch+persist orchestration into `EventIngest`, normalizing ingest context via `EventIngestContext`, and explicitly containing the remaining legacy session-id recursion in `AgentEventLog` as a compatibility fallback behind `EventEnvelope` parsing.
  - Relocated the remaining typed controllers under `lib/hive_server_elixir_web/controllers/typed/` and validated the cleanup with targeted controller/agent/template/workspace tests plus a full `mix precommit` pass.

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
- 2026-03-05 - Added Elixir resource summary contract payloads (`/api/cells/:id/resources`) with optional history/averages/rollups fields to unblock global resources UI parity.
- 2026-03-05 - Added Elixir service payload resource keys for `includeResources=true` so service dashboards can consume resource metadata without frontend fallbacks.
- 2026-03-05 - Added Elixir workspace + template API parity routes so frontend workspace management and template loading can run against the cutover backend without TS fallbacks.
- 2026-03-06 - Added Elixir `/api/agents/models`, `/api/agents/sessions/:id/models`, and `/api/agents/sessions/byCell/:cellId` parity routes so frontend model/session queries can run against the cutover backend without TS fallbacks.
- 2026-03-06 - Added Elixir `/api/agents/sessions/:id/messages` and `/api/agents/sessions/:id/events` parity routes, plus session-id fallback resolution from persisted OpenCode event logs when explicit agent-session rows are absent.
- 2026-03-06 - Updated E2E and desktop E2E runtime runners to start `apps/hive_server_elixir` instead of `apps/server`, completing Step 7 backend-targeting prep for automated suites.
- 2026-03-06 - Added Elixir-runner migration/bootstrap/workspace-registration hardening; desktop smoke launch now passes on Elixir backend while targeted web E2E still reports session/workspace contract parity gaps.
- 2026-03-06 - Closed targeted Elixir-backed E2E contract gaps for plan mode/workspace switching via session initialization + mode mutation endpoint + API CORS/preflight support; targeted web+desktop specs now pass.
- 2026-03-07 - Closed terminal websocket route parity for chat/setup/service UI terminals by routing web terminal clients through Phoenix channel topics and removing legacy `/terminal/ws` dependency.
- 2026-03-07 - Fixed chat terminal restart contract regression by stopping synthetic `chat_terminal_exit` events on restart responses/channels.
- 2026-03-07 - Added session model/provider fallback resolution from timeline and workspace OpenCode config so session contracts return stable model metadata during early-session lifecycle.
- 2026-03-07 - Added cell workspace snapshot creation under `HIVE_HOME/cells/:cell_id`, template-driven setup execution, template service materialization/startup, service SSE routing parity, and terminal-backed session message fallback; full Elixir-backed web E2E now passes.
- 2026-03-07 - Migrated CLI runtime startup away from `@hive/server` so the compiled `hive` binary now runs Elixir directly (`mix ecto.migrate` + `mix phx.server`) and verified start/info/logs/stop lifecycle locally.
- 2026-03-07 - Removed remaining active `@hive/server` and `apps/server` runtime/dependency references from config generation, frontend RPC typing, and root tooling scripts while preserving the dormant legacy tree for later deletion.
- 2026-03-07 - Hardened the Elixir local-only runtime perimeter, persisted active workspace recency, bounded terminal output retention, made OpenCode event sequencing concurrency-safe, and tightened `Cell.status` invariants with passing backend coverage.
- 2026-03-08 - Continued Step 9 controller consolidation by moving workspace register/activate/delete and agent session-by-cell/mode actions onto Ash RPC, updating frontend query/e2e callers to generated RPC contracts, and shrinking the remaining custom Phoenix surface to finite JSON reads plus streaming/terminal transport.
- 2026-03-08 - Moved cell create/retry/resume/delete/delete-many mutations onto Ash RPC generic actions, shifted lifecycle event/audit side effects into the Ash/domain path, updated web/E2E callers to `/rpc/run`, and removed the remaining finite cell lifecycle mutation routes from `CellsController`.
- 2026-03-08 - Moved service list/start/stop/restart and bulk service lifecycle commands onto Ash RPC typed-map actions, extracted shared service snapshot shaping for RPC plus SSE parity, updated web/E2E callers to generated RPC contracts, and removed the remaining finite service JSON routes from `CellsController`.
- 2026-03-08 - Moved `GET /api/cells/:id/diff` and `GET /api/cells/:id/resources` onto `AshTypescript.TypedController`, extracted shared resource snapshot/failure shaping out of `CellsController`, updated web diff/resources queries to generated controller route helpers, and reduced the remaining custom Phoenix cell controller surface to streams plus terminal transport.
- 2026-03-11 - Continued Step 9 bounded-context cleanup by consolidating workspace path/config ownership, extracting shared Ash/controller/payload helpers, moving OpenCode fetch+persist orchestration into `EventIngest`, explicitly containing the remaining `AgentEventLog` legacy session-id fallback, relocating typed controllers under `hive_server_elixir_web/controllers/typed/`, and verifying the slice with targeted backend tests plus `mix precommit`.
