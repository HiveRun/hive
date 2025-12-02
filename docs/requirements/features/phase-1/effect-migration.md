# Effect Migration

- [/] Effect Migration #status/active #phase-1 #feature/platform
  - [x] [HIVE-19] Build Effect service adapters for worktree manager and agent runtime
  - [x] [HIVE-20] Effect-ify cells provisioning and routes
  - [x] [HIVE-23] Effect-ify agents routes with Effect services

## Goal
Finish the transition to Effect-first services for shared backend modules so routes and tests can rely on context tags instead of global utilities.

## New Layers
- `WorktreeManagerService` / `WorktreeManagerLayer` (`apps/server/src/worktree/manager.ts`): wraps the worktree manager with Effect helpers for `createManager`, `createWorktree`, and `removeWorktree`, loading Hive config automatically while keeping legacy exports intact for incremental migration.
- `AgentRuntimeService` / `AgentRuntimeLayer` (`apps/server/src/agents/service.ts`): Effect wrappers for agent session lifecycle helpers (ensure/fetch/interrupt/send, provider catalog) wired through the server runtime.

## Migration Notes
- Legacy promise-based functions remain available; prefer the new context tags in new code to avoid direct database/filesystem imports.
- `serverLayer` now includes these layers so `runServerEffect` consumers get the adapters without manual wiring.
