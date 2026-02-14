# Effect Migration

- [x] Effect Migration #status/active #phase-1 #feature/platform
  - [x] [HIVE-19] Build Effect service adapters for worktree manager and agent runtime
  - [x] [HIVE-20] Effect-ify cells provisioning and routes
  - [x] [HIVE-23] Effect-ify agents routes with Effect services
  - [x] [HIVE-25] Effect-ify CLI commands
  - [x] [HIVE-27] Effect-ify templates routes and config loading
  - [x] [HIVE-22] Finalize Effect migration cleanup
  - [x] [HIVE-32] Complete full Effect-native migration of worktree and routes
  - [x] [HIVE-40] Remove direct Effect/@effect dependencies and Effect-style runtime APIs
  - [x] [HIVE-41] Remove remaining compatibility wrappers and Effect-style aliases

## Goal
Retire external Effect runtime dependencies while keeping server/CLI behavior stable and test coverage green.

## Migration Notes
- Removed `effect`, `@effect/platform`, and `@effect/language-service` from workspace dependencies/tooling.
- Removed the temporary internal `@hive/task` compatibility package after completing Promise-native migration in server and tests.
- Migrated `packages/cli` and `apps/server` from `@hive/task` effects to native `async`/`await` Promise flows and removed direct `@hive/task` dependencies.
- Migrated `apps/server` routes for workspaces/templates/agents away from `Task` pipelines and `runServerEffect` wrappers to direct Promise-based handlers.
- Migrated `apps/server/src/routes/cells.ts` dependency loading and recovery helpers (`resumeSpawningCells`, worktree cleanup/provision context wiring) from `Task` combinators to Promise-based flow and converted affected tests/helpers to Promise-native mocks.
- Updated `apps/server/src/workspaces/plugin.ts` and workspace context resolution to Promise-native interfaces only.
- Removed the temporary `runServerEffect` compatibility shim (`apps/server/src/runtime.ts`) and updated callsites/tests to direct Promise/service usage (`apps/server/src/runtime.services.test.ts`, `apps/server/src/routes/cells.ts`).
- Removed remaining Effect-style alias exports (`*ServiceTag`, `*Layer`, `*Effect`) from server modules (`agents/service.ts`, `worktree/manager.ts`, `workspaces/registry.ts`, `workspaces/context.ts`, `workspaces/removal.ts`, terminal services) and updated callsites.
- Renamed CLI Promise helpers from effect-oriented naming to runtime utility naming (`packages/cli/src/runtime-utils.ts`, `packages/cli/src/cli.runtime-utils.test.ts`).
- Kept lint/tooling dependencies (for example `ultracite`) when they only introduce optional transitive `effect` references outside runtime code paths.
- Validation target: no direct `effect` / `@effect/*` dependencies in runtime package manifests and no runtime code imports from `effect`.
- Cells provisioning still surfaces full `TemplateSetupError` detail (`templateId`, `workspacePath`, `command`, `exitCode`) through `lastSetupError`.
