# AI Tooling

- Regenerate `AGENTS.md` with `bun run ruler:apply`; it concatenates `.ruler/prompts/*.md` in priority order.
- Keep authoring guidance in this directory so automated agents inherit updates without manual edits.
- No Cursor or GitHub Copilot override files exist; Ruler prompts are the single source of truth for agent context.
- When adding new workflows, prefer short, action-focused bullets so the generated handbook stays compact (~20 lines).
- Keep the OpenCode repository cloned in `vendor/opencode/` for reference only; production code and runtime integrations must depend on the published `@opencode-ai/sdk` package.
- Documentation lives inside the `docs/` Obsidian vault. When you need context, open/inspect the markdown files there (agents, requirements, tasks, etc.) rather than expecting external knowledge bases, and update those docs when your work changes the project plan.
- When the user requests a change to agent guidance or project docs, proactively locate the relevant file(s) and make the update without waiting for another reminder.
- Update `.ruler/prompts/*.md` whenever guidance for agents changes; the prompt bundle is our source of truth for AI behavior.
- Commit prompt changes like any other source code so CI and Husky enforce lint/type/build checks.
