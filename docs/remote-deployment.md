# Private Remote Deployment

Hive can run as a private remote instance in Docker Compose. This is intended for a VPS/Railway-like host reached through Cloudflare Tunnel + Cloudflare Access, Tailscale, VPN, or an equivalent private access layer.

Hive does not provide native authentication in this release. Do not expose the Hive service directly to the public internet. Anyone who can reach the Hive API can control cells, terminals, workspaces, services, stored integrations, and service previews.

## Architecture

```text
Desktop / browser
  -> Cloudflare Access, Tailscale, VPN, or private network gate
  -> Docker Compose Hive service
  -> /home/hive/.hive state + /workspaces projects
```

## Deploy

```bash
cp deploy/docker/.env.example deploy/docker/.env
$EDITOR deploy/docker/.env
docker compose -f deploy/docker/docker-compose.yml up -d --build
curl http://127.0.0.1:3000/health
```

Set these values in `.env`:

```bash
HIVE_INSTANCE_NAME=Private Remote Hive
HIVE_PUBLIC_API_URL=https://hive.example.com
HIVE_PUBLIC_WEB_URL=https://hive.example.com
```

Use `docker-compose.cloudflare.yml` only after configuring a Cloudflare Tunnel and Cloudflare Access policy:

```bash
docker compose \
  -f deploy/docker/docker-compose.yml \
  -f deploy/docker/docker-compose.cloudflare.yml \
  up -d --build
```

The tunnel should send traffic to `http://hive:3000`.

## Connect Desktop

```bash
hive instance add vps https://hive.example.com --use
hive desktop
```

Desktop should connect as a remote client. It must not start or stop a local Hive daemon for this profile.

## Workspaces

Remote workspace paths are paths inside the container/host, not paths on your laptop. The default allowed root is `/workspaces`.

Mount or clone projects under `/workspaces`, then register them in Hive from the UI or API.

## Backup And Upgrade

Back up before upgrades:

- `hive-home` volume.
- `hive-workspaces` volume or bind mount.
- OpenCode/provider config mount.

Upgrade by pulling/building the new image and restarting Compose. Roll back by restoring the prior image tag and volume backup.

## Known Limits

- No native Hive auth or RBAC.
- No public internet safety without external access controls.
- SQLite is single-instance state.
- Service proxy support is path-based and may need follow-up for some WebSocket, cookie, or root-relative asset patterns.
