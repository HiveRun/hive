# AI Tooling

- Regenerate `AGENTS.md` with `bun run ruler:apply`; it concatenates `.ruler/prompts/*.md` in priority order.
- Keep authoring guidance in this directory so automated agents inherit updates without manual edits.
- No Cursor or GitHub Copilot override files exist; Ruler prompts are the single source of truth for agent context.
- When adding new workflows, prefer short, action-focused bullets so the generated handbook stays compact (~20 lines).
- Use the published `@opencode-ai/sdk` package for runtime integrations.
- Project documentation is distributed across several key locations:
  - `CONCEPTS.md` - High-level concepts (cells, templates, services, etc.)
  - `docs/migrations/elixir-hard-cutover.md` - Active backend migration plan and execution status
  - `.ruler/prompts/` - AI agent guidance and coding standards  
  - `README.md` - Project overview and getting started
  When you need context, prioritize these markdown sources over external knowledge bases.
- Before pushing, run `bun run check:push` (lint, types, unit tests, build).
- Run `bun run test:e2e` when modifying cell lifecycle, terminal handling, service orchestration, or workspace management.
- Do not parallelize resource-heavy local verification commands in this repo (`bun run test:e2e`, Playwright spec runs, desktop E2E, or other commands that spawn full app stacks/browsers/opencode servers); run one at a time and wait for it to finish before starting another.
- Before starting a new E2E/browser run after an interruption, inspect for stale runner/browser/opencode processes from your own prior attempts and clean up only those leftovers; do not kill the user's long-lived dev servers.
- For `apps/e2e` changes, prefer deterministic checks (session/message metadata + UI confirmation) instead of fixed sleeps.
- Keep E2E fixtures/config in sync with runtime defaults (provider/model IDs, template labels) so test behavior matches production paths.
- When the user requests a change to agent guidance or project docs, proactively locate the relevant file(s) and make the update without waiting for another reminder.
- Update `.ruler/prompts/*.md` whenever guidance for agents changes; the prompt bundle is our source of truth for AI behavior.
- For package/framework behavior in `apps/hive_server_elixir`, verify current docs first with `mix usage_rules.search_docs "<query>" -p <package>`, `mix usage_rules.docs Module.function/arity`, or `mix help <task>` before implementation.
- Dependency guidance is provided via generated skills in `.agents/skills/`; refresh them with `mise x -C apps/hive_server_elixir -- mix usage_rules.sync --yes` and prefer `/usage-rules-update` in OpenCode when you want to update the package and regenerate managed skills.
- Do not manually edit managed skill blocks between `<!-- usage-rules-skill-start -->` and `<!-- usage-rules-skill-end -->`.
- Commit prompt changes like any other source code so CI and Husky enforce lint/type/build checks.
- **Documentation PR References**: Use sequential step numbers (Step 1, Step 2, etc.) instead of actual GitHub PR numbers in planning documents. This prevents reference mismatches when PR sequences change or when implementation diverges from original plans.
