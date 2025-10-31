# Hive Historical Documentation

These files capture the reference architecture and workflows from Hive, the Elixir/Phoenix + Ash predecessor to Synthetic. They were imported from Hive PR #169 (https://github.com/HiveRun/hive/pull/169) so we can revisit proven patterns while translating them into the Bun/TypeScript stack.

## What's Included

- `ARCHITECTURE.md` – high-level system goals and components
- `CORE_CONCEPTS.md` – terminology and operating model
- `AGENT_WORKFLOWS.md` – lifecycle, health, and recovery flows
- `TEMPLATE_SYSTEM.md` – environment templating and isolation rules
- `IMPLEMENTATION_GUIDE.md` – design principles and patterns
- `API_REFERENCE.md` – external API surface: GraphQL, WS, CLI
- `CLI_DESKTOP.md` – user interfaces for orchestration
- `SECURITY.md` – defense-in-depth and access control strategy
- `OBSIDIAN_INTEGRATION_PLAN.md` – documentation + requirements vault plan

## How to Use

Treat these documents as historical requirements. When defining Synthetic features, reference them for intent and proven workflows, then capture the Synthetic-specific plan under `docs/` (outside this historical folder) so we can track what has been reimagined or replaced.
