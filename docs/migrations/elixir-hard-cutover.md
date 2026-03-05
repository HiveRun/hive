# Elixir Hard Cutover Migration Plan

## Execution Snapshot

- Current Step: Step 3 - Persist-all event ingest pipeline (next).
- Next Action: add append-only `agent_event_log` schema + migration and wire event envelope persistence from OpenCode stream ingest.
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

### Step 4: Ash Resources + Reactor Flows

- Model core resources: workspace, cell, provisioning, service, agent session, activity, timing.
- Implement flows: create, retry, delete, resume with compensation.
- Done means:
  - Key lifecycle flows execute and recover correctly.
  - Flow failures emit meaningful domain error states.

### Step 5: Realtime + Terminal Transport

- Implement SSE/WS streams used by frontend.
- Preserve terminal event semantics (`ready/snapshot/data/exit/error`).
- Done means:
  - Terminal and stream hooks work unchanged at behavior level.
  - Reconnect paths remain stable.

### Step 6: Frontend Contract Migration (React)

- Remove Eden dependency path.
- Replace with generated TS client/types from new backend contracts.
- Rewrite query factories and stream hooks as needed.
- Done means:
  - Web app runs fully against Elixir backend.
  - No frontend imports from `@hive/server`.

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
