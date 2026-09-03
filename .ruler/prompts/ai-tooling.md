# AI Tooling

- Regenerate `AGENTS.md` with `bun run ruler:apply`; it concatenates `.ruler/prompts/*.md` in priority order.
- Keep authoring guidance in this directory so automated agents inherit updates without manual edits.
- No Cursor or GitHub Copilot override files exist; Ruler prompts are the single source of truth for agent context.
- When adding new workflows, prefer short, action-focused bullets so the generated handbook stays compact (~20 lines).
- Use the pinned `@opencode-ai/client` Promise API for OpenCode 2 runtime integrations.
- Project documentation is distributed across several key locations:
  - `CONCEPTS.md` - High-level concepts (cells, templates, services, etc.)
  - `.ruler/prompts/` - AI agent guidance and coding standards  
  - `README.md` - Project overview and getting started
  When you need context, prioritize these markdown sources over external knowledge bases.
- `AGENTS.md` is a committed generated artifact for OpenCode. After changing `README.md` or `.ruler/prompts/*.md`, run `bun run ruler:apply` and commit the regenerated `AGENTS.md`.
- Before pushing, run `bun run check:push` (lint, types, unit tests, build). Expensive hardware/runtime E2E suites remain explicit commands rather than commit hooks.
- Use `bun run test:e2e:fast` while iterating on cell lifecycle, terminal handling, service orchestration, or workspace management, then run the default `bun run test:e2e` before creating a PR.
- For Android emulator, viewer, or audio changes, run `bun run test:e2e:android-service-audio` on a capable host before declaring completion. This validates the packaged release, both audio directions, restart behavior, cleanup, and the evidence MP4.
- Do not stop at unit tests when behavior crosses compiled, packaged, browser, Electron, process, or device boundaries. Exercise the shipped boundary that can differ from source development.
- Treat failed verification as new evidence: inspect logs/artifacts, fix the root cause, rerun the exact failure, then rerun adjacent lifecycle paths such as restart, repeat execution, cache reuse, and cleanup.
- Adversarially review wrappers around shared host resources. Test option aliases, alternate argument forms, global commands, stale ownership, and teardown races instead of validating only the happy-path command shape.
- Keep working autonomously through production-only failures when the next diagnostic step is available. Stop only for destructive choices, missing credentials/hardware, or genuinely ambiguous product decisions.
- For `apps/e2e` changes, prefer deterministic checks (session/message metadata + UI confirmation) instead of fixed sleeps.
- Keep E2E fixtures/config in sync with runtime defaults (provider/model IDs, template labels) so test behavior matches production paths.
- Treat `.hive/` and generated `.opencode/state/` and `.opencode/themes/` paths as runtime artifacts that should not be committed. Keep `opencode.json` plus intentional source under `.opencode/plugins/` trackable; Hive writes its cell plugin into spawned worktrees.
- When the user requests a change to agent guidance or project docs, proactively locate the relevant file(s) and make the update without waiting for another reminder.
- Update `.ruler/prompts/*.md` whenever guidance for agents changes; the prompt bundle is our source of truth for AI behavior.
- Commit prompt changes like any other source code so CI and Husky enforce lint/type/build checks.
- **Documentation PR References**: Use sequential step numbers (Step 1, Step 2, etc.) instead of actual GitHub PR numbers in planning documents. This prevents reference mismatches when PR sequences change or when implementation diverges from original plans.
