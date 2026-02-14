# AI Tooling

- Regenerate `AGENTS.md` with `bun run ruler:apply`; it concatenates `.ruler/prompts/*.md` in priority order.
- Keep authoring guidance in this directory so automated agents inherit updates without manual edits.
- No Cursor or GitHub Copilot override files exist; Ruler prompts are the single source of truth for agent context.
- When adding new workflows, prefer short, action-focused bullets so the generated handbook stays compact (~20 lines).
- Keep the OpenCode repository cloned in `vendor/opencode/` for reference only; production code and runtime integrations must depend on the published `@opencode-ai/sdk` package.
- Project documentation is distributed across several key locations:
  - `docs/` Obsidian vault - Requirements, implementation plans, project context
  - `.ruler/prompts/` - AI agent guidance and coding standards  
  - `README.md` - Project overview and getting started
  When you need context, prioritize these markdown sources over external knowledge bases and update them when your work changes the project plan.
- Feature development progress is tracked in `docs/requirements/features/` using Tasks format. Always update the corresponding feature file's task status when starting/completing work so progress is visible to all agents.
  - **Status updates**: `[ ]` → `[/]` when starting work, `[/]` → `[x]` when completed, `[ ]` → `[-]` if blocked
  - **Phase ordering provides natural priority**: Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4
  - **Always check feature file first** for requirements, integration points, and testing strategy before starting work
- Before pushing, run `bun run check:push` (lint, types, unit tests, build).
- Run `bun run test:e2e` when modifying cell lifecycle, terminal handling, service orchestration, or workspace management.
- For `apps/e2e` changes, prefer deterministic checks (session/message metadata + UI confirmation) instead of fixed sleeps.
- Keep E2E fixtures/config in sync with runtime defaults (provider/model IDs, template labels) so test behavior matches production paths.
- When the user requests a change to agent guidance or project docs, proactively locate the relevant file(s) and make the update without waiting for another reminder.
- Update `.ruler/prompts/*.md` whenever guidance for agents changes; the prompt bundle is our source of truth for AI behavior.
- Commit prompt changes like any other source code so CI and Husky enforce lint/type/build checks.
- **Documentation PR References**: Use sequential step numbers (Step 1, Step 2, etc.) instead of actual GitHub PR numbers in planning documents. This prevents reference mismatches when PR sequences change or when implementation diverges from original plans.
