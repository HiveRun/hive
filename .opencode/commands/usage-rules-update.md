---
description: Update usage_rules and regenerate managed skills
---

Update `usage_rules` and refresh generated skills for this repository.

Steps:
1. Run `mix deps.update usage_rules` from `apps/hive_server_elixir`.
2. Run `mix usage_rules.sync --yes` from `apps/hive_server_elixir`.
3. Re-run `mix usage_rules.sync --check --yes` to confirm no remaining drift.
4. Show a concise summary of what changed in:
   - `apps/hive_server_elixir/mix.exs`
   - `apps/hive_server_elixir/mix.lock`
   - `.agents/skills/`
5. Flag any missing reference links inside managed skills (if found).

When done, include:
- Updated version number for `usage_rules`.
- Whether sync is clean.
- Suggested commit message.
