# Workspace & Template Configuration

This document covers authoring `synthetic.config.ts`, managing templates, and assembling prompts. For runtime considerations see [Construct Runtime](constructs/runtime.md).

## Workspace Configuration
- Locate a `synthetic.config.ts` at the repo root exporting strongly typed workspace settings (one per project repository).
- Ship a small runtime+types package (e.g., `@synthetic/config`) that exposes `defineSyntheticConfig` so users author configs like:
  ```ts
  import { defineSyntheticConfig } from "@synthetic/config"

  export default defineSyntheticConfig({
    opencode: { workspaceId: "workspace_123", token: process.env.OPENCODE_TOKEN },
    promptSources: ["docs/prompts/**/*.md"],
    templates: [
      {
        id: "full-stack-dev",
        label: "Full Stack Dev Sandbox",
        summary: "Boot a web client, API, and database for general feature work",
        prompts: ["docs/prompts/full-stack.md"],
        services: [/* ... */]
      }
    ]
  })
  ```
  The helper returns the input value, but constrains keys and value types for intellisense and compile-time validation.
- `opencode`: workspace ID and authentication token reference (direct value or pointer to env var) used by every construct session.
- `promptSources`: defines the reusable prompt fragments (files, directories, globs, ordering) that Synthetic concatenates into `AGENTS.md`; TypeScript ensures ergonomic autocompletion and highlights missing env bindings.
- `templates`: reusable construct templates (inline for v1) that describe services, default teardown routines, and template-scoped prompt inclusions; the UI lets users pick a template when creating a construct instance.
- Expose a `synthetic config lint` CLI to validate the emitted config (paths exist, duplicates resolved) before provisioning constructs, compiling the TS file on the fly.

## Construct Template Definition (v1)
Keep templates inline within `synthetic.config.ts` for v1 simplicity. Templates satisfy the `ConstructTemplate` type and the UI generates construct instances by layering task metadata (name, description, review notes) on top of them.

```ts
export default defineSyntheticConfig({
  opencode: { workspaceId: "workspace_123", token: process.env.OPENCODE_TOKEN },
  promptSources: ["docs/prompts/**/*.md"],
  templates: [
    {
      id: "full-stack-dev",
      label: "Full Stack Dev Sandbox",
      summary: "Run web, API, and database services for iterative product work",
      prompts: ["docs/prompts/full-stack.md"],
      services: [
        {
          name: "web",
          type: "process",
          setup: ["bun install", "bun run db:push"],
          run: "bun run dev:web",
          cwd: "apps/web",
          ports: [
            {
              name: "http",
              env: "WEB_PORT",
              preferred: 3001
            }
          ],
          env: {
            PORT: "${env.WEB_PORT}",
            VITE_API_URL: "http://localhost:${env.API_PORT}"
          },
          readyPattern: /ready in/,
          stop: "bun run dev:web -- --stop"
        },
        {
          name: "api",
          type: "process",
          run: "bun run dev:server",
          cwd: "apps/server",
          ports: [
            {
              name: "http",
              env: "API_PORT",
              preferred: 3000
            }
          ],
          env: {
            DATABASE_URL: "postgresql://synthetic:synthetic@localhost:${env.POSTGRES_PORT}/synthetic"
          },
          readyPattern: /Http server start/,
          stop: "bun run dev:server -- --stop"
        },
        {
          name: "postgres",
          type: "docker",
          image: "postgres:16",
          env: {
            POSTGRES_USER: "synthetic",
            POSTGRES_PASSWORD: "pgpass!",
            POSTGRES_DB: "synthetic"
          },
          ports: [
            {
              name: "db",
              container: 5432,
              env: "POSTGRES_PORT",
              preferred: 5432
            }
          ],
          volumes: ["${constructDir}/volumes/postgres:/var/lib/postgresql/data"],
          readyPattern: /database system is ready to accept connections/,
          stop: "docker stop synthetic-construct-postgres"
        }
      ],
      teardown: ["bun run db:reset", "pkill -f bun"]
    }
  ]
})
```

- `prompts`: template-scoped prompt fragments (files or globs) merged into the agent briefing in addition to the global prompt bundle.
- `services`: each service can declare optional `setup` commands that run before its `run` command, plus optional `cwd`, `env`, regex `readyPattern`, and a `stop` command; `ports` is an array of port requests (`name`, optional `preferred`, optional `container` for docker) that Synthetic resolves to free host ports (probing the actual OS rather than relying solely on internal state) and exports as env vars (custom name via `env`). `type` defaults to `process` but also supports `docker` and `compose`.
- `teardown`: optional commands to clean up services/resources when the construct stops.

## Prompt Assembly

### Agent Briefing & Prompt Assembly
- Store a repository-level Markdown template (`docs/agents/base-brief.md`) that explains Synthetic's purpose, the construct concept, guardrails, and escalation expectations.
- When provisioning a construct, concatenate the base brief with:
  - Task summary and acceptance criteria from the construct metadata.
  - Tabular list of configured services with resolved hostnames/ports and any exposed env vars.
  - Template-level prompt fragments declared on the selected template (`prompts` field) so domain-specific guidance accompanies the construct.
  - Explicit boundaries (e.g., "Work only inside this construct; do not alter services or files belonging to other constructs") and safety reminders (secret handling, infrastructure limits).
  - Links or relative paths to important resources (worktree root, docs, scripts) the agent may need.
- Inject the composed Markdown into the initial OpenCode SDK prompt so the agent starts with full situational awareness without the user retyping context.
- Reuse the same assembled brief when the agent session restarts to keep context consistent.

### Prompt Source Management
- Read `promptSources` from `synthetic.config.ts`, supporting files, directories, or glob patterns (e.g., "docs/prompts/**/*.md").
- Respect optional ordering by allowing entries to be objects with `path` and `order` so users pin high-priority primers ahead of feature guides; type definitions expose autocomplete for these keys.
- Allow templates to list additional `prompts` that reference files within the built bundle (or absolute paths) so each construct instance can append domain-specific guidance automatically.
- Provide a CLI task (`synthetic prompts build`) that resolves the configured sources through the TypeScript config, deduplicates headings, and concatenates them into `AGENTS.md` (and other provider-specific outputs) consumed by constructs.
- Rebuild prompt bundles during provisioning and whenever the config changes so agents always read the latest documentation snapshot.
- Expose the generated bundle path in construct metadata so the agent prompt assembly pipeline can link or embed sections as needed.
