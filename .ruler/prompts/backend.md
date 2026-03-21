# Backend Patterns

## Runtime Backend

- Hard cutover plan: `docs/migrations/elixir-hard-cutover.md`
- Hive now runs against `apps/hive_server_elixir`; treat it as the only active backend runtime.
- If dormant `apps/server` code still exists during cleanup, do not route new features or runtime wiring through it.

## Backend (`apps/hive_server_elixir`)

- Stack: Phoenix API, Ash, AshSqlite, Reactor, Oban Lite.
- Model state transitions and business actions in Ash resources/actions.
- Treat Ash as the application data API: call `Ash.*` and resource actions from domain modules instead of direct `Repo`/`Ecto.Query`.
- Put multi-step workflows (create/retry/delete/resume) in Reactor with compensation paths.
- Persist OpenCode event ingestion in append-only logs first, then project into query models.

## Tooling & Commands

- Backend dev: `bun run dev:server` or `mix phx.server` from `apps/hive_server_elixir`
- Backend tests: `mix test` from `apps/hive_server_elixir`
- Migration/codegen tasks: `bun run db:migrate` and `bun run db:generate`

## Backend Rules

- Keep local-first runtime constraints front and center (single required Hive daemon, SQLite default).
- Restrict direct Ecto usage to infrastructure concerns (migrations, repo setup, sandbox/test plumbing, low-level adapters where Ash cannot express the behavior).
- When contracts change, update frontend query factories and migration docs in the same change.
- Record major backend decisions in the migration doc change log so the cutover trail stays explicit.
