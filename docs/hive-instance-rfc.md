# Hive Instance RFC

Status: Draft

## Summary

Hive should have one product model: a **Hive Instance** owns runtime state, and **Hive Clients** connect to an instance.

The default install still starts a local instance on the user's machine. A company deployment is the same product running on shared company infrastructure. Desktop, browser, and CLI clients connect to the selected instance.

SSH, Tailscale, Cloudflare Tunnel, reverse proxies, Docker, systemd, and hosted deployment scripts are access, bootstrap, or deployment mechanisms. They should not create separate product variants.

## Decision

Use the instance/client boundary as Hive's main architecture boundary:

- The instance owns the database, `HIVE_HOME`, workspace registry, cell worktrees, setup commands, services, terminals, OpenCode processes, logs, activity, and service preview routing.
- Clients own presentation, connection selection, local client credentials, and local UI preferences.
- Local-first behavior remains the default by selecting and managing the built-in `local` instance.
- Company/team usage is an explicitly deployed shared instance with auth, admin visibility, and operational controls layered onto the same runtime model.

## Product Model

### Hive Instance

A Hive Instance is one stateful Hive server/runtime boundary. It may run on a laptop, a workstation, a VPS, a company VM, or a container host.

The instance owns:

- SQLite or future production database state.
- `HIVE_HOME`, logs, pid/ready files where applicable, and managed runtime artifacts.
- Workspace registry and workspace paths on the instance filesystem.
- Cell worktrees and copied include files.
- Template setup commands and service processes.
- OpenCode server/processes and agent sessions.
- PTYs, terminal scrollback/logs, SSE, and WebSocket streams.
- Activity and timing events.
- Service preview/proxy records.

### Hive Client

A Hive Client is Desktop, browser, or CLI. A client connects to one selected instance at a time.

The client owns:

- Instance selection and connection status.
- User-local instance profiles and credentials.
- Browser/Desktop local UI state and cache.
- User prompts for setup, connection, auth, or dangerous actions.

Clients must not own long-running remote process lifetime. If a laptop sleeps or disconnects, a remote/company instance should continue owning cells, agents, services, and logs.

### Access Endpoint

An access endpoint is how a client reaches an instance. Examples:

- Local loopback: `http://localhost:3000`.
- LAN/VPN URL: `https://hive.company.internal`.
- Tailscale URL or MagicDNS host.
- Cloudflare Tunnel URL.
- SSH-forwarded localhost URL.

Changing the endpoint should not change what a Hive Instance is.

### Launch Or Bootstrap Method

A launch method starts or prepares an instance. Examples:

- Local CLI daemon launch.
- Desktop-managed local daemon launch.
- Systemd service on a VM.
- Docker or Docker Compose.
- SSH bootstrap onto a host.

SSH diagnostics and future SSH bootstrap should answer: "Can this host run a Hive Instance?" They should not define a separate SSH-worker runtime product.

## Goals

- Collapse local, personal remote, and company deployments into one mental model.
- Preserve current local defaults and installer behavior.
- Support shared company instances where colleagues connect to the same runtime and admins can observe instance activity.
- Keep secrets and credentials in user-local config or server-side instance config, never committed workspace config.
- Make service URLs and client cache instance-aware.
- Leave room for future control-plane/runner architecture without prematurely splitting the product.

## Non-Goals For The First Slice

- Full RBAC, SSO, billing, or team invite workflows.
- Horizontally scaled/stateless Hive API instances.
- Separate SSH-specific runtime product mode.
- Automatic upload of local `.env*` or shell environment to a remote/company instance.
- Full service preview proxy implementation in the initial rename slice.

## CLI Direction

Use `hive instance` for commands that inspect or manage client-visible instances.

Initial implemented command:

```bash
hive instance doctor gpu-box
hive instance doctor user@example.com --ssh-port 2222 --ssh-identity ~/.ssh/id_ed25519
```

`instance doctor` is a read-only SSH diagnostic. It checks host readiness for a future Hive Instance bootstrap:

- SSH connectivity.
- Remote platform basics.
- Required host tools: `git`, `bun`, `opencode`.
- Instance root existence and writability.

Planned client registry commands:

```bash
hive instance list
hive instance add company --url https://hive.company.internal
hive instance use company
hive instance remove company
hive instance open company
```

`local` should be a built-in instance profile. User-added profiles should live in user-local client config, not project config.

Example client config shape:

```json
{
  "selectedInstance": "local",
  "instances": {
    "local": { "type": "local", "label": "Local Hive" },
    "company": {
      "type": "remote",
      "label": "Company Hive",
      "url": "https://hive.company.internal",
      "authRef": "env:HIVE_COMPANY_TOKEN"
    }
  }
}
```

## Instance Metadata

Add an instance metadata endpoint before building deeper client switching:

```http
GET /api/instance
```

Suggested payload:

```json
{
  "id": "inst_...",
  "name": "Company Hive",
  "version": "0.0.0",
  "publicUrl": "https://hive.company.internal",
  "capabilities": {
    "mode": "local",
    "authRequired": false,
    "serviceProxy": false,
    "adminVisibleSessions": false
  }
}
```

Useful environment/config keys:

- `HIVE_INSTANCE_NAME`
- `HIVE_INSTANCE_ID` or generated persisted id under `HIVE_HOME`
- `HIVE_PUBLIC_URL`
- Future: `HIVE_AUTH_MODE`, `HIVE_ADMIN_EMAIL`, `HIVE_INVITE_MODE`

Clients should scope caches and persistence by instance id or URL so local and company instance data cannot bleed together.

## Desktop Behavior

Desktop needs an explicit startup distinction:

- **managed-local**: current behavior; detect/start/reuse the local daemon.
- **remote-client**: connect to a configured instance URL; do not start, stop, pid-detect, or mutate a local daemon.

Remote-client mode should:

- Poll the configured health URL.
- Expose the selected instance URL through `window.hiveDesktop.runtimeInfo.backendUrl`.
- Show reconnecting/remote status in startup UI.
- Keep local daemon controls disabled or clearly scoped to local mode.

## Company Instance And Admin Visibility

A company instance should eventually make admin visibility first-class because all runtime state is owned centrally by the instance.

Near-term observability can show existing single-instance data:

- Registered workspaces.
- Active cells.
- Running services.
- Agent/session status.
- Recent cell activity and timing events.
- Instance health and resource usage when available.

Full team/admin mode requires additional design:

- Users and login sessions.
- Roles and memberships.
- Workspace ownership and membership.
- Authenticated actor ids on activity events.
- Global audit feed.
- Rules for whether admins may attach to another user's terminal/session or only view metadata.

Do not fake actor IDs before auth exists. Add real attribution with auth.

## Service Preview Strategy

Current local service URLs often resolve to `localhost:<port>`. That fails when services run on a remote/company instance and the browser runs elsewhere.

The instance model should separate:

- `runtimeUrl`: server-local service URL used by the instance.
- `browserUrl`: client-safe URL returned to UI.

Preferred first remote-safe approach:

```text
https://hive.company.internal/api/cells/:cellId/services/:serviceId/proxy/*
```

Later wildcard subdomains can improve compatibility:

```text
https://<service-id>--<cell-id>.services.company.internal/
```

Service proxy work must consider WebSockets, cookies, root-relative assets, host headers, CORS, and dev servers that bind only to loopback.

## Security Notes

- CORS is not auth.
- Any non-local or company instance needs real auth before exposing sensitive APIs beyond trusted private networks.
- Protect REST, SSE, WebSockets, terminal input, service proxy routes, workspace browsing, and integration token routes.
- Store client tokens in user-local config or env references.
- Do not silently copy local env files/secrets to another instance.

## Implementation Milestones

1. Rename current SSH diagnostic docs/CLI/tests to instance-doctor terminology.
2. Add instance metadata endpoint and client instance labeling.
3. Add user-local instance registry and `hive instance add/list/use/remove/open` commands.
4. Add Desktop remote-client mode that skips local daemon startup.
5. Add auth foundation for non-local/team instances.
6. Add service proxy/browser URL separation.
7. Add admin/observability views backed by real auth and actor attribution.

## Critical Files

- `packages/cli/src/cli.ts`
- `packages/cli/src/instance-doctor.ts`
- `packages/cli/src/instance-doctor.test.ts`
- `packages/cli/e2e/instance-doctor.docker.test.ts`
- `apps/server/src/server.ts`
- `apps/server/src/config/runtime-env.ts`
- `apps/server/src/routes/cells.ts`
- `apps/server/src/routes/workspaces.ts`
- `apps/server/src/workspaces/registry.ts`
- `apps/server/src/worktree/manager.ts`
- `apps/server/src/agents/service.ts`
- `apps/web/src/lib/api-base.ts`
- `apps/web/src/router.tsx`
- `apps/web/src/routes/__root.tsx`
- `apps/desktop-electron/src/runtime-info.ts`
- `apps/desktop-electron/src/startup-controller.ts`

## Verification Strategy

Immediate CLI/doc slice:

- `bun run check:biome`
- `bun run test:run` from `packages/cli`
- `bun run test:e2e:instance-doctor` from `packages/cli`
- `bun src/index.ts instance doctor --help` from `packages/cli`
- `git diff --check`
- `bun run check:commit`

Future remote-client slice:

- Unit test that Desktop remote-client mode never calls daemon startup.
- Browser/Desktop smoke with `HIVE_DESKTOP_BACKEND_URL` pointing to an existing instance.
- Instance-scoped query/cache tests.

Future team/admin slice:

- Route tests for instance metadata and admin/observability endpoints.
- E2E with two browser contexts connected to the same instance showing shared state.
- Auth/RBAC tests before exposing multi-user admin controls.
