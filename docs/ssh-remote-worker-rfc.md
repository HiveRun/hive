# SSH Remote Worker RFC

Status: Draft

## Summary

Hive should support remote compute through SSH targets that run a small remote Hive worker. The local Desktop/web client stays the operator UI. The remote worker owns remote workspaces, cell worktrees, setup commands, agent processes, PTYs, service processes, logs, and port-forward metadata.

This is different from pointing Desktop at a hosted Hive server. SSH remote worker mode treats SSH as the private transport and the remote machine as the runtime source of truth. It should feel like local Hive with a remote execution target.

## Recommendation

Build remote Hive around an Orca-style remote runtime model:

- Keep local mode as the default.
- Add user-local SSH targets.
- Install or launch a remote Hive worker over SSH.
- Create remote canonical workspaces and remote cell worktrees on the remote host.
- Run setup, services, OpenCode, terminals, and file operations through the remote worker.
- Keep environment files and secrets remote by default.
- Reconnect to remote worker state after laptop sleep, network loss, or battery death.
- Use SSH port forwarding for remote service previews.

The existing remote-backend/Railway/Tailscale work can remain an optional deployment path, but it should not be the main remote-compute architecture until Hive has a stronger authentication and multi-client server story.

## Goals

- Let users run Hive cells on a remote machine without exposing a public Hive API.
- Preserve local-first behavior and local workspaces.
- Make remote setup inspectable with `hive remote doctor <target>`.
- Keep remote env and secrets explicit, not silently copied from the laptop.
- Preserve cell and terminal state when the local app disconnects.
- Make service previews reachable from the laptop via managed SSH forwards.
- Reuse existing template semantics, including `includePatterns`, on the remote host.
- Keep the first version single-user and SSH-authenticated.

## Non-Goals

- Hosted SaaS, team tenancy, billing, or RBAC.
- Public HTTPS as the default remote transport.
- Automatic upload of all local `.env*` files on first connect.
- Full filesystem sync between local and remote hosts.
- Running arbitrary remote commands without a worker/supervisor for durable cells.
- Replacing local Hive server mode.

## Product Model

### Local Client

The local client is the Hive Desktop app, web shell, or CLI. It owns local UI state, target selection, connection status, and user prompts. It should not own long-running remote process lifetime.

### SSH Target

An SSH target is a user-local connection profile. It can reference an OpenSSH config alias or direct host details. Secrets stay outside committed workspace config.

Suggested user-local shape:

```json
{
  "targets": {
    "gpu-box": {
      "type": "ssh",
      "host": "gpu-box",
      "port": 22,
      "identityFile": "~/.ssh/id_ed25519",
      "workspaceRoot": "~/hive-workspaces"
    }
  }
}
```

### Remote Hive Worker

The remote worker is a small Hive runtime service started over SSH. It should be versioned with the local client and installed under a remote Hive home such as `~/.hive/worker`.

The worker owns:

- Remote workspace registry.
- Remote canonical workspace checkout/import.
- Remote cell worktrees.
- Template setup and service processes.
- OpenCode processes and chat/agent sessions.
- PTY leases, scrollback, and logs.
- Detected remote ports and configured forwards.
- Remote env status metadata without secret values.

### Remote Canonical Workspace

The canonical workspace is the remote host's source workspace for a project. Remote cells are created from this workspace. It is not a transparent mirror of the laptop checkout.

Initial import options:

- Clone from git remote and branch/ref.
- Use an existing remote path.
- Later: upload a patch or archive explicitly when the user asks for local state transfer.

### Remote Cell Worktrees

Remote cells are git worktrees on the remote host. They should use the same branch naming, template setup, and include-copy behavior as local cells.

For env-related include patterns, the source is the remote canonical workspace:

```text
Local mode:
local canonical workspace -> local cell worktree

Remote mode:
remote canonical workspace -> remote cell worktree
```

## Env And Secret Handling

Remote env should be explicit and safe by default.

Rules:

- The remote host is the runtime source of truth.
- Remote cells copy `includePatterns` from the remote canonical workspace, not from the laptop.
- Hive must not silently upload `.env*` files or shell env values.
- Hive may detect missing env files or keys and report names only.
- Any sync from local to remote must be explicit, auditable, and redacted in logs.
- Remote env sync should support dry-run before writing files.

Recommended commands:

```bash
hive remote doctor gpu-box
hive remote env status gpu-box --workspace hive
hive remote env sync gpu-box --workspace hive --dry-run
hive remote env sync gpu-box --workspace hive --files .env .env.local
```

Env status should answer:

- Which configured include patterns match remote files.
- Which expected files are missing remotely.
- Which required key names appear to be missing, when Hive can infer names.
- Which files would be copied into a remote cell.

Env status must not print secret values.

## Resumability

Remote resumability depends on process ownership. Raw SSH command execution is not enough because agent processes may die or lose terminal scrollback when the laptop disconnects.

The remote worker should own long-running state:

- PTY process leases.
- Agent process leases.
- Service process leases.
- Append-only logs or bounded scrollback snapshots.
- Cell state and timing events.
- Forwarded port records.

Battery-death flow:

1. Laptop dies and SSH disconnects.
2. Remote worker keeps cells, PTYs, agents, and services alive.
3. Remote worker continues writing logs and state under remote `HIVE_HOME`.
4. User reopens Hive and reconnects to the SSH target.
5. Hive reattaches to worker sessions and restores cell status, terminal scrollback, and ports.

## Port Forwarding And Previews

Service processes should bind on the remote host as they do locally. The local client should expose previews by managing SSH forwards.

Required behavior:

- Detect remote listening ports where possible.
- Let users manually add forwards.
- Persist forward intent per remote target and workspace.
- Prefer local loopback addresses such as `http://127.0.0.1:<localPort>` for previews.
- Auto-remap privileged remote ports to unprivileged local ports.
- Do not expose random remote service ports publicly.

The first version can start with manual forwards. Automatic detection can come after the worker can report remote process and socket state.

## Security Model

SSH authentication is the first security boundary. The remote worker should not listen publicly by default.

Rules:

- Bind worker APIs to remote loopback or a private Unix socket.
- Access the worker through SSH channels or forwards only.
- Do not persist SSH key passphrases in Hive config.
- Do not copy local secrets unless the user runs an explicit sync command.
- Redact env values in all logs, diagnostics, and errors.
- Treat remote shell commands as operating on the remote user's account.

Future public or multi-client access still requires proper Hive auth. SSH worker mode should not depend on public API auth being complete.

## CLI UX

Initial command surface:

```bash
hive remote doctor gpu-box
hive remote add gpu-box --host gpu-box --workspace-root ~/hive-workspaces
hive remote list
hive remote env status gpu-box --workspace hive
hive remote env sync gpu-box --workspace hive --dry-run
hive desktop --remote gpu-box
```

`remote doctor` should check:

- Local `ssh` availability.
- SSH connectivity.
- Remote platform basics.
- Remote required tools: `git`, `bun`, `opencode`.
- Remote workspace root existence and writability.
- Later: worker install/version and remote Hive home state.

## Worker Protocol

The worker protocol should start narrow and versioned.

Early operations:

- `worker.ping`
- `workspace.importExisting`
- `workspace.clone`
- `workspace.list`
- `cell.create`
- `cell.list`
- `cell.attach`
- `terminal.input`
- `terminal.resize`
- `terminal.snapshot`
- `ports.list`
- `ports.forward`

Transport options:

- Step 1 can use SSH exec for diagnostics only.
- Step 2 should start a remote worker process and talk over stdio or an SSH-forwarded loopback port.
- Step 3 can add a persistent remote worker daemon for reconnect and lease ownership.

## Implementation Plan

Step 1: SSH target and doctor foundation.

- Add pure helpers for SSH target normalization and doctor command construction.
- Add `hive remote doctor <target>`.
- Do not modify workspace or env files.

Step 2: User-local target storage.

- Add `hive remote add/list/remove` backed by user-local Hive config.
- Import OpenSSH config aliases without storing private key material.
- Keep committed `hive.config.json` limited to target preference names, not secrets.

Step 3: Remote workspace bootstrap.

- Add commands to register an existing remote path or clone a repo remotely.
- Record remote canonical workspace metadata in the remote worker state.
- Verify git worktree creation on the remote host.

Step 4: Remote worker prototype.

- Install or upload a versioned worker artifact under remote `HIVE_HOME`.
- Start it over SSH.
- Implement `ping`, `workspace.list`, and basic cell listing.

Step 5: Remote cell creation.

- Move cell creation through the worker.
- Reuse current worktree manager behavior on the remote host.
- Copy include patterns from the remote canonical workspace to remote cell worktrees.

Step 6: Remote agents and PTY leases.

- Run OpenCode and terminals under worker-owned leases.
- Persist scrollback/logs remotely.
- Reattach after local client reconnect.

Step 7: Remote previews.

- Add manual SSH forwards.
- Add remote port detection.
- Rewrite preview links to local forwarded URLs.

Step 8: Env management.

- Add redacted env status.
- Add explicit env sync with dry-run.
- Add tests proving secret values are not logged.

## Testing Strategy

- Unit-test target parsing, SSH argument construction, shell quoting, and redaction.
- Unit-test env status behavior with fixture workspaces.
- Integration-test doctor against a local SSH fixture when available.
- E2E-test remote cell creation with a Docker SSH target before real host testing.
- Desktop-test reconnect behavior by killing the local app while remote worker processes remain running.

## Open Questions

- Should the first worker communicate over stdio, a Unix socket, or SSH-forwarded loopback HTTP?
- Should worker installation reuse the compiled Hive binary or ship a smaller worker artifact?
- How much OpenSSH config parsing should Hive own versus delegating fully to `ssh`?
- Should env sync be file-based only at first, or support individual key editing?
- Should remote targets be global user config only, or can workspaces reference target names as preferred execution intent?
