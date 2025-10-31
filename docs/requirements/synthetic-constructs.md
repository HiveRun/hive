# Synthetic Constructs Requirements (Draft)

## Vision & Goals
- Centralize multi-agent coding work so each task runs inside an isolated "construct" with its own workspace, services, and context.
- Lower the cognitive overhead of juggling multiple agents by surfacing status, queues, and review artifacts in one UI.
- Keep users inside Synthetic for review by embedding diffs, file browsing, and agent transcripts.
- Treat Synthetic as an extension of the developer environment: agents inherit local toolchains, environment variables, and access to running services.

## Construct Model
- **Definition**: A construct bundles the task brief, linked worktree, configured services, agent session, and history of actions.
- **Lifecycle (v1)**: Draft brief → Provision (run setup tasks & services) → Active (agent executing) → Awaiting Review (agent paused / needs input) → Reviewing (human diff/feedback) → Complete or Parked (snapshot for later).
- **State Capture**: Persist key metadata (task, status, timestamps), agent transcript, shell command log, and diff bundles for context restoration.

## Agent Orchestration
- Anchor on the official OpenCode SDK for all agent interactions (init sessions, send prompts, stream tool events, fetch artifacts). Avoid TUI screen scraping.
- Run constructs directly in the host environment so agents share the users credentials, PATH, and dependencies; no supervised pods for v1.
- Require top-level user configuration of OpenCode workspace/API keys, then let each construct reuse those credentials alongside its default prompt.
- Prepare for future adapters by defining a provider interface, but only implement the OpenCode path in the initial release.

## Persistence
- Use SQLite as the primary store for constructs, transcripts, statuses, and metadata so we gain ACID writes with minimal setup.
- Persist large artifacts, command logs, and diff bundles as raw files on disk referenced from the SQLite tables for fast streaming in the UI.
- Keep migration overhead light by versioning the schema alongside app releases and offering a simple `synthetic migrate` command.

## Provisioning Manifest (JSON, v1)
Single `construct.json` per construct to describe provisioning steps.

```json
{
  "name": "Implement auth",
  "description": "Add user auth flow with session storage",
  "services": [
    {
      "name": "web",
      "type": "process",
      "setup": ["bun install", "bun run db:push"],
      "run": "bun run dev:web",
      "cwd": "apps/web",
      "ports": [
        {
          "name": "http",
          "env": "WEB_PORT",
          "preferred": 3001
        }
      ],
      "env": {
        "PORT": "${env.WEB_PORT}",
        "VITE_API_URL": "http://localhost:${env.API_PORT}"
      },
      "readyPattern": "ready in",
      "stop": "bun run dev:web -- --stop"
    },
    {
      "name": "api",
      "type": "process",
      "run": "bun run dev:server",
      "cwd": "apps/server",
      "ports": [
        {
          "name": "http",
          "env": "API_PORT",
          "preferred": 3000
        }
      ],
      "env": {
        "DATABASE_URL": "postgresql://synthetic:synthetic@localhost:${env.POSTGRES_PORT}/synthetic"
      },
      "readyPattern": "Http server start",
      "stop": "bun run dev:server -- --stop"
    },
    {
      "name": "postgres",
      "type": "docker",
      "image": "postgres:16",
      "env": {
        "POSTGRES_USER": "synthetic",
        "POSTGRES_PASSWORD": "synthetic",
        "POSTGRES_DB": "synthetic"
      },
      "ports": [
        {
          "name": "db",
          "container": 5432,
          "env": "POSTGRES_PORT",
          "preferred": 5432
        }
      ],
      "volumes": ["${constructDir}/volumes/postgres:/var/lib/postgresql/data"],
      "readyPattern": "database system is ready to accept connections",
      "stop": "docker stop synthetic-construct-postgres"
    }
  ],
  "agent": {
    "opencodeWorkspaceId": "workspace_123",
    "initialPrompt": "Implement auth as described in the brief",
    "promptTemplatePath": null
  },
  "teardown": ["bun run db:reset", "pkill -f bun"]
}
```

- `services`: each service can declare optional `setup` commands that run before its `run` command, plus optional `cwd`, `env`, regex `readyPattern`, and a `stop` command; `ports` is an array of port requests (`name`, optional `preferred`, optional `container` for docker) that Synthetic resolves to free host ports and exports as env vars (custom name via `env`). Templating like `${env.API_PORT}` is available to the service itself, other services, and the agent. `type` defaults to `process` but also supports `docker` (with `image`, `ports`, `volumes`, `command`) and `compose` (referencing a Docker Compose file translated into per-service units). Synthetic does not auto-stop long-running services—users stay in control via the defined `stop` or teardown commands.
- `agent`: SDK configuration for the OpenCode adapter; the agent process inherits the constructed env map, including generated service ports/URLs.
- `teardown`: optional commands to clean up services/resources when the construct stops.

Templating supports `${env.VAR_NAME}` and `${constructDir}` to keep configs declarative; Synthetic resolves them before running setup, service, or teardown commands.

### Docker & Compose Support
- For `type: "docker"` services, Synthetic runs `docker run` with the declared `image`, `command` (optional), `ports`, `env`, and `volumes`; port requests pick an open host port, map it to the declared container port, and expose the value through the configured env name. Volume paths support `${constructDir}` templating so persistent data lives alongside the construct workspace.
- Docker services use deterministic container names (`synthetic-{constructId}-{serviceName}`) so stop commands can be autogenerated when omitted.
- For `type: "compose"`, point to a Compose file (`composePath`) and optional service filter; Synthetic parses the file, injects templated variables (including generated ports/env vars), and starts the selected services with the same status tracking/ready detection pipeline.
- When Compose is involved, generated per-service shims expose the same lifecycle hooks (ready pattern, stop) to keep the UI consistent.

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
