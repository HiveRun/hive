# Hive Instance RFC

Status: Draft

## Summary

Hive has one product model: a **Hive Instance** owns runtime state, and **Hive Clients** connect to an instance.

The default install still starts a managed local instance on the user's machine. The first remote target is a **private remote instance**: the same Hive runtime running on a VPS/Railway-like host with Docker Compose, reachable only through Cloudflare Access, Tailscale, VPN, or an equivalent private access layer.

Hive does not provide native authentication in this implementation slice. Do not expose a remote instance directly to the public internet. Anyone who can reach the Hive API can control workspaces, cells, terminals, services, integrations, and service previews.

## Decision

Use the instance/client boundary as Hive's main architecture boundary:

- The instance owns the database, `HIVE_HOME`, workspace registry, cell worktrees, setup commands, services, terminals, OpenCode processes, logs, activity, and service preview routing.
- Clients own presentation, instance selection, external access/login flow, local UI state, and user-local instance profiles.
- Local-first behavior remains the default by selecting and managing the built-in `local` instance.
- Private remote usage runs the same instance in Docker Compose and relies on an external private access control boundary.
- Team/company/public-safe usage requires future Hive-native auth, actor attribution, and authorization before it can be claimed as supported.

SSH, Tailscale, Cloudflare Tunnel, reverse proxies, Docker, and hosted deployment platforms are access, bootstrap, or deployment mechanisms. They should not create separate product variants.

## Product Model

### Hive Instance

A Hive Instance is one stateful Hive server/runtime boundary. It may run on a laptop, workstation, VPS, company VM, or container host.

The instance owns:

- SQLite database state.
- `HIVE_HOME`, logs, pid/ready files where applicable, and runtime artifacts.
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
- External access interaction, such as Cloudflare Access browser login.
- User-local instance profiles.
- Browser/Desktop local UI state and cache.

Clients must not own remote process lifetime. If a laptop sleeps or disconnects, a private remote instance should keep owning cells, agents, services, and logs.

### Access Endpoint

An access endpoint is how a client reaches an instance. Examples:

- Local loopback: `http://localhost:3000`.
- Private tunnel URL: `https://hive.example.com` protected by Cloudflare Access.
- Tailscale URL or MagicDNS host.
- VPN/LAN URL.
- SSH-forwarded localhost URL.

Changing the endpoint should not change what a Hive Instance is.

### Launch Or Deployment Method

A launch method starts or prepares an instance. Examples:

- Local CLI daemon launch.
- Desktop-managed local daemon launch.
- Docker Compose on a VPS.
- Cloudflare Tunnel sidecar in Compose.
- Future SSH/systemd bootstrap.

The first full remote implementation uses Docker Compose. SSH diagnostics answer: "Can this host run a Hive Instance?" They do not define a separate SSH-worker runtime product.

## Goals

- Preserve current local defaults and installer behavior.
- Support a usable private remote instance on a VPS/Railway-like host.
- Make Desktop the primary remote client.
- Keep service URLs and client cache instance-aware.
- Keep secrets and credentials in user-local config or explicit server-side mounts/config, never committed workspace config.
- Avoid silently uploading local `.env*` files or shell environment to a remote instance.
- Leave room for future native auth/team mode without pretending it exists now.

## Non-Goals For This Slice

- Native Hive auth, RBAC, SSO, billing, team invites, or tenant isolation.
- Public internet safety without Cloudflare Access/VPN/Tailscale/equivalent protection.
- Horizontally scaled/stateless Hive API instances.
- Automatic upload of local secrets to a remote instance.
- SSH/systemd bootstrap as the primary supported deployment path.
- Full wildcard-subdomain service preview support.

## Remote Runtime Contract

Private remote instances should use an explicit runtime contract:

```bash
HIVE_INSTANCE_MODE=private-remote
HIVE_INSTANCE_NAME="My Remote Hive"
HIVE_PUBLIC_API_URL=https://hive.example.com
HIVE_PUBLIC_WEB_URL=https://hive.example.com
HIVE_INTERNAL_API_URL=http://127.0.0.1:3000
HIVE_REMOTE_ACCESS_ACK=private-network-only
HIVE_ALLOWED_WORKSPACE_ROOTS=/workspaces
HIVE_BROWSE_ROOT=/workspaces
HOST=0.0.0.0
PORT=3000
```

`HIVE_REMOTE_ACCESS_ACK=private-network-only` is intentionally required for private remote mode because Hive has no built-in auth in this slice.

## CLI Direction

Use `hive instance` for commands that inspect or manage client-visible instances.

Implemented commands:

```bash
hive instance list
hive instance add vps https://hive.example.com --use
hive instance use vps
hive instance remove vps
hive instance open vps
hive instance doctor gpu-box
hive instance doctor user@example.com --ssh-port 2222 --ssh-identity ~/.ssh/id_ed25519
```

`local` is a built-in instance profile. User-added profiles live in user-local client config, not project config.

`--token-env` is reserved for a future Hive-native or external gateway auth flow. It stores only an environment variable name; it does not authenticate Hive API requests today.

`instance doctor` is a read-only SSH diagnostic. It checks host readiness for a future Hive Instance bootstrap:

- SSH connectivity.
- Remote platform basics.
- Required host tools: `git`, `bun`, `opencode`.
- Instance root existence and writability.

It does not install Hive, upload env files, or start a remote server.

## Instance Metadata

Hive exposes instance metadata at:

```http
GET /api/instance
```

The payload reports identity, URLs, mode, capabilities, and warnings. In private remote mode it must state that native auth is disabled and `publicInternetSafe` is `false`.

Clients should scope caches and persistence by instance id or URL so local and private remote data cannot bleed together.

## Desktop Behavior

Desktop has an explicit startup distinction:

- **managed local**: current behavior; detect/start/reuse the local daemon.
- **remote client**: connect to a configured instance URL; do not start, stop, pid-detect, or mutate a local daemon.

Remote-client mode should:

- Poll the configured health URL.
- Expose the selected instance URL through `window.hiveDesktop.runtimeInfo.backendUrl`.
- Show remote connection status and no-Hive-auth warnings.
- Support Cloudflare Access or equivalent external login by loading the remote web origin when required.
- Keep local daemon controls disabled or clearly scoped to local mode.

## Service Preview Strategy

Local service URLs often resolve to `localhost:<port>`. That fails when services run on a private remote instance and the browser/Desktop runs elsewhere.

The instance model separates:

- `runtimeUrl`: server-local service URL used only by the instance.
- `directUrl`: currently the same as `runtimeUrl` for diagnostics/local use.
- `browserUrl`: client-safe URL returned to UI.

Preferred first remote-safe approach:

```text
https://hive.example.com/api/cells/:cellId/services/:serviceId/proxy/*
```

Later wildcard subdomains can improve compatibility:

```text
https://<service-id>--<cell-id>.services.example.com/
```

Service proxy work must consider WebSockets, request bodies, cookies, root-relative assets, host headers, CORS, and dev servers that bind only to loopback.

## Security Notes

- CORS is not auth.
- Hive has no native auth in this implementation slice.
- Protect private remote deployments with Cloudflare Access, Tailscale, VPN, or equivalent controls.
- Anyone who can reach the API can control terminals, services, workspace registration, stored integrations, and service proxy routes.
- Store client tokens in user-local config or env references.
- Do not silently copy local env files/secrets to another instance.

## Future Native Auth/Team Work

Team/company/public-safe usage requires additional design:

- Users and login sessions.
- Roles and memberships.
- Workspace ownership and membership.
- Authenticated actor ids on activity events.
- Global audit feed.
- Rules for whether admins may attach to another user's terminal/session or only view metadata.

Do not fake actor IDs before auth exists. Add real attribution with auth.

## Implementation Milestones

1. Reframe current instance/client foundation as private remote, not public/team-safe.
2. Add private remote runtime contract, metadata capabilities, same-origin web serving, and workspace root allowlist.
3. Add Docker Compose deployment artifacts and remote deployment docs.
4. Make Desktop remote-client the primary workflow.
5. Complete enough service proxy behavior for remote previews.
6. Add remote Docker Compose E2E and CI gates.
7. Publish Docker images with releases.
8. Add native auth/RBAC in a later product phase.

## Verification Strategy

Foundation checks:

```bash
bun run check:commit
cd packages/cli && bun run test:e2e:instance-doctor
```

Full remote acceptance, once implemented:

```bash
bun run test:e2e:remote
bun run test:e2e:desktop
```

Manual acceptance:

1. Run Hive with Docker Compose on a VPS.
2. Protect it with Cloudflare Access/Tunnel or equivalent private access.
3. Add it locally with `hive instance add vps https://hive.example.com --use`.
4. Launch `hive desktop`.
5. Register a workspace under `/workspaces`.
6. Create a cell, stream chat/terminal, run a service, and open the service preview.
7. Restart the container and confirm state persists.
