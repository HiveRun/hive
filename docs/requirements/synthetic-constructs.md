# Synthetic Constructs Requirements (Draft)

## Vision & Goals
- Centralize multi-agent coding work so each task runs inside an isolated "construct" with its own workspace, services, and context.
- Lower the cognitive overhead of juggling multiple agents by surfacing status, queues, and review artifacts in one UI.
- Keep users inside Synthetic for review by embedding diffs, file browsing, and agent transcripts.
- Treat Synthetic as an extension of the developer environment: agents inherit local toolchains, environment variables, and access to running services.
- Optimize for a single operator managing their own project; multi-user coordination is out of scope for v1.

## Construct Model
- **Definition**: A construct bundles the task brief, linked worktree, configured services, agent session, and history of actions. Constructs are instantiated from reusable templates defined in `synthetic.config.ts`; each construct is owned and operated by the same single user who controls the workspace.
- **Lifecycle (v1)**: Draft brief → Template selection & provisioning (run setup tasks & services) → Active (agent executing) → Awaiting Review (agent paused / needs input) → Reviewing (human diff/feedback) → Complete or Parked (snapshot for later).
- **State Capture**: Persist key metadata (task, status, timestamps), agent transcript, shell command log, and diff bundles for context restoration. Retain the template reference so users can rehydrate or clone constructs.

## Agent Orchestration
- Anchor on the official OpenCode SDK for all agent interactions (init sessions, send prompts, stream tool events, fetch artifacts). Avoid TUI screen scraping.
- Keep a local clone of https://github.com/sst/opencode in `vendor/opencode/` for reference only; production code must depend on the published `@opencode-ai/sdk` package, never the clone.
- Run constructs directly in the host environment so agents share the user's credentials, PATH, and dependencies; no supervised pods for v1.
- Require top-level user configuration of OpenCode workspace/API keys via `synthetic.config.ts`, then let each construct reuse those credentials alongside its default prompt.
- Users author construct templates in the same config; the UI instantiates constructs from those templates by layering task-specific metadata (name, description, review notes).
- Prepare for future adapters by defining a provider interface, but only implement the OpenCode path in the initial release.
- Before creating an OpenCode session, inspect the user's OpenCode config/auth store (`auth.json`) to confirm credentials exist for the provider the template demands; if missing, block the session and prompt the user to run `opencode auth login` (no additional runtime retries beyond surfacing the error toast).
- Assemble each agent session prompt from a base Markdown primer describing Synthetic, constructs, and the agent's role; append construct-specific context (task brief, running services, resolved ports/URLs, constraints on external resources).
- Maintain prompt source configuration so large knowledge bases can be composed from modular files rather than a single monolith.

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
- Track registered projects in a global registry (e.g., `~/.synthetic/workspaces.json`) mapping friendly names to repo roots so the operator can hop between multiple codebases without co-locating configs.

## Persistence
- Use SQLite as the primary store for constructs, transcripts, statuses, and metadata so we gain ACID writes with minimal setup.
- Persist large artifacts, command logs, and diff bundles as raw files on disk referenced from the SQLite tables for fast streaming in the UI.
- Keep migration overhead light by versioning the schema alongside app releases and offering a simple `synthetic migrate` command.

## Construct Template Definition (TypeScript, v1)
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
- `services`: each service can declare optional `setup` commands that run before its `run` command, plus optional `cwd`, `env`, regex `readyPattern`, and a `stop` command; `ports` is an array of port requests (`name`, optional `preferred`, optional `container` for docker) that Synthetic resolves to free host ports (probing the actual OS rather than relying solely on internal state) and exports as env vars (custom name via `env`). Templating like `${env.API_PORT}` is available to the service itself, other services, and the agent. `type` defaults to `process` but also supports `docker` (with `image`, `ports`, `volumes`, `command`) and `compose` (referencing a Docker Compose file translated into per-service units). Synthetic does not auto-stop long-running services—users stay in control via the defined `stop` or teardown commands.
- `teardown`: optional commands to clean up services/resources when the construct stops.

Templating supports `${env.VAR_NAME}` and `${constructDir}` to keep configs declarative; Synthetic resolves them before running setup, service, or teardown commands.

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

### Workspace Discovery & Switching
- On first launch, prompt the operator to choose a directory; if it contains a `synthetic.config.ts`, register it immediately.
- When a directory contains multiple subdirectories, scan only the immediate children for `synthetic.config.ts` and offer those as registrable workspaces.
- Persist registrations in the global workspace registry and surface all entries in a project dropdown (header or sidebar) so switching is a single click.
- Switching workspaces updates the active repo context, constructs list, and services in-place; because Synthetic runs as a single instance, it can coordinate port assignments and avoid collisions automatically.
- Construct templates, histories, and artifacts remain isolated to their workspace; Synthetic never mixes constructs across projects.
- Provide a simple “Add workspace” action (UI + CLI) that lets the operator point Synthetic at new repo roots at any time; removal simply deletes the registry entry without touching the underlying project.
- Existing single-project users can continue registering only one workspace; adding more later just extends the registry without changing per-project configs.

### Dogfooding Requirements
- The Synthetic repository itself must be runnable as a workspace so the platform can build and test itself; templates and tooling must work when the app is under active development.
- Port allocation always probes the real host (not just internal state) so constructs spawned inside Synthetic avoid collisions with the live instance.
- Every construct operates in its own git worktree; installs and commands run in that worktree to prevent lockfile or artifact conflicts with the running workspace.
- Templates reference paths relative to the workspace root so dogfooding instances inherit prompts, configs, and scripts without special casing.

### Single-User Assumptions
- Synthetic assumes a single operator per workspace for v1; no shared accounts, concurrent edits, or cross-user notifications are supported.
- Construct ownership, notifications, and status changes target that operator alone; collaboration workflows remain future scope.


### Docker & Compose Support
- For `type: "docker"` services, Synthetic runs `docker run` with the declared `image`, `command` (optional), `ports`, `env`, and `volumes`; port requests pick an open host port, map it to the declared container port, and expose the value through the configured env name. Volume paths support `${constructDir}` templating so persistent data lives alongside the construct workspace.
- Docker services use deterministic container names (`synthetic-{constructId}-{serviceName}`) so stop commands can be autogenerated when omitted.
- For `type: "compose"`, point to a Compose file (`composePath`) and optional service filter; Synthetic parses the file, injects templated variables (including generated ports/env vars), and starts the selected services with the same status tracking/ready detection pipeline.
- When Compose is involved, generated per-service shims expose the same lifecycle hooks (ready pattern, stop) to keep the UI consistent.

## Platform Modalities
- **Web app**: ship the full experience in the browser (SSR/SPA) for zero-install access.
- **Desktop app (Electron)**: wrap the web UI in Electron to unlock native notifications, tray integration, and richer OS hooks while keeping JS tooling and Chromium rendering parity. We can explore Tauri later if bundle size becomes critical.
- **Parity expectations**: desktop and web share features and code paths; desktop adds native notifications and future enhancements (tray, auto-launch, voice capture) without diverging UX.

## UX Requirements
- **Construct Workspace**: Show live agent transcript, pinned brief, status timeline, running services status, and quick actions (pause, nudge, terminate).
- **Global Queue**: Present constructs waiting on human input sorted by wait time, with filters per provider and SLA indicators.
- **Notifications**: Trigger desktop/in-app (and optional Slack/webhook) alerts when constructs block on user input, finish, or encounter errors; include deep links.
- **Diff Review**: Provide inline/side-by-side diff viewer with file tree, syntax highlighting, quick accept/reject controls, and comment threads without leaving Synthetic.
- **Context Switching Aids**: Recent activity feed, saved filters, keyboard shortcuts, and status badging to help regain context quickly.

## Future Extensions Roadmap

**Phase 1 – Post-MVP Foundations**
- `Templates & snippets`: ship a library of reusable construct briefs/manifests with tagging and quick-start selection.
- `Cross-construct search`: index transcripts, command logs, and artifacts so users can find prior solutions; ship with simple keyword search UI.
- `Metrics baseline`: capture per-construct timing (active vs waiting) and human intervention count; expose read-only dashboard inside Synthetic.

**Phase 2 – Collaboration & Governance**
- `Collaboration suite`: allow assigning owners, sharing read-only construct views, and pushing status updates to external trackers (linear/jira webhook).
- `Security guardrails`: implement secret scanning on agent outputs, per-construct access controls, and configurable retention windows for transcripts/artifacts.

**Phase 3 – Advanced Interaction**
- `Voice input`: add microphone capture, streaming transcription, and push-to-talk UX inside agent conversations; fall back to text if transcription fails.
- `Insight analytics`: evolve the metrics baseline into trend reporting (cycle time, agent idle time) with slice/dice filters and export.

## Open Questions
- What retention policy should we adopt for persisted logs and artifacts to balance disk usage with traceability?
