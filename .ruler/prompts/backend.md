# Backend Patterns

## Migration Status

- Hard cutover plan: `docs/migrations/elixir-hard-cutover.md`
- During migration, treat `apps/server` as legacy and `apps/hive_server_elixir` as the target backend.
- Prefer implementing net-new backend behavior in the Elixir path instead of expanding legacy Elysia code.

## Legacy Backend (`apps/server`)

- Stack: Elysia + Drizzle + SQLite.
- Use this path for maintenance, bug fixes, and compatibility while migration is in progress.
- If you must touch request validation there, keep existing TypeBox patterns consistent.

## Target Backend (`apps/hive_server_elixir`)

- Stack: Phoenix API, Ash, AshSqlite, Reactor, Oban Lite.
- Model state transitions and business actions in Ash resources/actions.
- Treat Ash as the application data API: call `Ash.*` and resource actions from domain modules instead of direct `Repo`/`Ecto.Query`.
- Put multi-step workflows (create/retry/delete/resume) in Reactor with compensation paths.
- Persist OpenCode event ingestion in append-only logs first, then project into query models.

## Tooling & Commands

- Legacy backend dev: `bun run dev:server` or `bun -C apps/server run dev`
- Legacy backend tests: `bun -C apps/server run test:run`
- Elixir backend dev: `mix phx.server` from `apps/hive_server_elixir`
- Elixir backend tests: `mix test` from `apps/hive_server_elixir`

## Migration Rules

- Keep local-first runtime constraints front and center (single required Hive daemon, SQLite default).
- Avoid introducing new Elysia/Eden-specific abstractions that increase migration surface area.
- Restrict direct Ecto usage to infrastructure concerns (migrations, repo setup, sandbox/test plumbing, low-level adapters where Ash cannot express the behavior).
- When contracts change, update frontend query factories and migration docs in the same change.
- Record major backend decisions in the migration doc change log so the cutover trail stays explicit.
