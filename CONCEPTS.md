# Hive Concepts

## What is Hive?

Hive is an agent orchestration platform that manages isolated development environments for AI coding agents. It coordinates AI agents, git worktrees, services, and terminals so you can run multiple autonomous coding sessions in parallel without conflicts.

## Core Concepts

### Workspace

A **workspace** is a git repository registered with Hive. It contains a `hive.config.json` file that defines templates and configuration. Workspaces are the top-level container for cells.

```
my-project/                    # Workspace root
├── hive.config.json           # Hive configuration
├── src/                       # Your source code
└── ...
```

### Cell

A **cell** is an isolated development environment within a workspace. Each cell gets:
- A dedicated **git worktree** (isolated checkout at `.hive/cells/<cell-id>/`)
- An **AI agent session** (powered by OpenCode)
- Zero or more **services** (databases, dev servers, etc.)
- Isolated **terminals** for command execution
- Durable runtime state at `$HIVE_HOME/runtime/cells/<cell-id>/`
- Preserved artifacts at `$HIVE_HOME/artifacts/cells/<cell-id>/`

Cells allow multiple agents to work on the same codebase simultaneously without stepping on each other's changes.

**Cell Lifecycle States:**
| Status | Description |
|--------|-------------|
| `spawning` | Cell is being created |
| `pending` | Cell exists but isn't fully provisioned |
| `ready` | Cell is operational |
| `error` | Cell failed to provision |
| `deleting` | Cell is being removed |

### Template

A **template** defines how cells are created. Templates specify:
- **Services**: What processes to run (databases, dev servers, etc.)
- **Setup commands**: One-time initialization (install deps, run migrations)
- **Agent config**: Which AI provider/model to use
- **Environment**: Environment variables for services
- **Prompts**: Agent briefing files
- **Teardown commands**: Cleanup run only during deletion or destructive provisioning rollback

```json
{
  "templates": {
    "dev": {
      "id": "dev",
      "label": "Development",
      "type": "manual",
      "services": {
        "db": {
          "type": "process",
          "run": "postgres",
          "ports": {
            "postgres": { "primary": true, "protocol": "tcp" }
          },
          "readiness": {
            "checks": [{ "type": "tcp", "port": "postgres" }]
          }
        },
        "web": {
          "type": "process",
          "run": "npm run dev -- --port $PORT",
          "dependsOn": ["db"]
        }
      },
      "setup": ["npm install", "npm run db:migrate"],
      "teardown": ["npm run dev:teardown"],
      "agent": { "providerId": "anthropic", "modelId": "claude-sonnet-4-20250514" }
    }
  }
}
```

Template setup, teardown, services, cell terminals, and OpenCode chat terminals receive `HIVE_CELL_ID`, `HIVE_HOME`, `HIVE_BROWSE_ROOT`, `HIVE_CELL_RUNTIME_DIR`, and `HIVE_CELL_ARTIFACTS_DIR`. They also receive persisted service port variables such as `WEB_PORT` and `WEB_METRICS_PORT`.

Teardown commands run sequentially after services stop and before the worktree is removed, with `HIVE_TEARDOWN_REASON` set to `delete` or `provisioning_rollback`. Each command has a 300-second timeout by default; set `HIVE_TEMPLATE_TEARDOWN_COMMAND_TIMEOUT_MS` to override it. Deletion removes the cell runtime directory after teardown succeeds but preserves the artifacts directory.

### Service

A **service** is a process managed by Hive within a cell. Process services are supported today; Docker and Compose definitions are reserved for future executors and fail provisioning explicitly.

| Type | Description | Example |
|------|-------------|---------|
| `process` | Direct command execution | `npm run dev` |
| `docker` | Reserved, not yet executable | PostgreSQL in a container |
| `compose` | Reserved, not yet executable | Full microservices environment |

Hive handles:
- Automatic port allocation
- Multiple persisted named ports with `http`, `https`, or `tcp` intent
- Explicit dependency ordering and TCP/HTTP readiness checks
- Process lifecycle (start/stop/restart)
- Log aggregation
- Health monitoring

Port references such as `$PORT:api` and `${PORT:api:metrics}` make allocated ports available to commands and environment values; they do not imply startup dependencies. Use `dependsOn` when one service must be ready before another starts.

### Agent Session

An **agent session** is an AI coding agent (via OpenCode) attached to a cell. The agent:
- Operates within the cell's worktree
- Has access to cell terminals
- Receives context from template prompts
- Streams messages in real-time to the UI

### Worktree

A **worktree** is a git working directory linked to the main repository. Each cell gets its own worktree at `.hive/cells/<cell-id>/`, allowing:
- Isolated file changes per cell
- Separate git branches per agent
- Parallel development without merge conflicts

### Terminal

Cells provide **terminals** for running commands:
- **Process terminals**: Attached to running services
- **Chat terminals**: For ad-hoc command execution

Terminals stream output via WebSocket and persist history.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Hive Runtime                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │   Cell A    │    │   Cell B    │    │   Cell C    │      │
│  │             │    │             │    │             │      │
│  │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────┐ │      │
│  │ │ Worktree│ │    │ │ Worktree│ │    │ │ Worktree│ │      │
│  │ └─────────┘ │    │ └─────────┘ │    │ └─────────┘ │      │
│  │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────┐ │      │
│  │ │ Agent   │ │    │ │ Agent   │ │    │ │ Agent   │ │      │
│  │ └─────────┘ │    │ └─────────┘ │    │ └─────────┘ │      │
│  │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────┐ │      │
│  │ │Services │ │    │ │Services │ │    │ │Services │ │      │
│  │ └─────────┘ │    │ └─────────┘ │    │ └─────────┘ │      │
│  └─────────────┘    └─────────────┘    └─────────────┘      │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                      Workspace (Git Repo)                    │
│                   .hive/cells/<cell-id>/                     │
└─────────────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `hive.config.json` | Workspace configuration (templates, services, agent defaults) |
| `.hive/cells/<id>/` | Cell worktree directory |
| `.hive/state/hive.db` | SQLite database (cells, services, events) |
| `.hive/logs/` | Runtime and service logs |

## Tech Stack

- **Backend**: Elysia (Bun) with Drizzle ORM
- **Frontend**: React + TanStack Start
- **Agent Runtime**: OpenCode SDK
- **Database**: SQLite (local) / PostgreSQL (production)
- **Communication**: Eden Treaty RPC, WebSockets
