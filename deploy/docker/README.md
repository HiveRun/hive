# Hive Docker Compose Deployment

This stack runs a private remote Hive Instance. Hive has no built-in authentication in this release. Protect the URL with Cloudflare Access, Tailscale, VPN, or equivalent controls.

## Quick Start

For local smoke testing from this repo, use the one-command helper. It starts
Docker Compose on [http://127.0.0.1:3100](http://127.0.0.1:3100), seeds and
registers `/workspaces/local-smoke`, verifies templates load, and prints next
steps:

```bash
bun run dev:remote
```

Useful variants:

```bash
bun run dev:remote -- --no-build  # reuse the current local image
bun run dev:remote -- --reset     # recreate local smoke volumes
bun run dev:remote:down           # stop and delete local smoke state
```

Manual deployment path:

```bash
cp deploy/docker/.env.example deploy/docker/.env
$EDITOR deploy/docker/.env
docker compose -f deploy/docker/docker-compose.yml up -d --build
curl http://127.0.0.1:3000/health
```

For Cloudflare Tunnel, create a tunnel that routes to `http://hive:3000`, add a Cloudflare Access policy, set `CLOUDFLARE_TUNNEL_TOKEN`, then run:

```bash
docker compose \
  -f deploy/docker/docker-compose.yml \
  -f deploy/docker/docker-compose.cloudflare.yml \
  up -d --build
```

## Client Setup

```bash
hive instance add vps https://hive.example.com --use
hive desktop
```

## Volumes

- `hive-home`: database, instance metadata, cells, logs, runtime state.
- `hive-workspaces`: remote workspace roots under `/workspaces`.
- `./opencode`: optional read-only OpenCode config mount.

Back up `hive-home`, `hive-workspaces`, and any mounted OpenCode/provider config before upgrades.
