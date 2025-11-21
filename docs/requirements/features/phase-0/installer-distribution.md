# Installer & Distribution Pipeline

- [x] Installer & Distribution Pipeline #status/complete #phase-0 #feature/distribution

Synthetic must be installable with a single `curl | sh` command that downloads a compiled Bun binary, its static frontend assets, and a ready-to-use local SQLite database path. This document tracks the requirements for that experience.

## Goals

- Ship a compiled `synthetic` binary that includes the API and serves the built UI statically.
- Publish platform-specific tarballs (`synthetic-<platform>-<arch>.tar.gz`) with the binary + frontend assets.
- Provide a curlable installer script that installs/updates releases into `~/.synthetic` (or a user-defined directory) and links the binary into `~/.synthetic/bin`.
- Ensure installed builds boot without extra setup by generating `synthetic.env` pointing to a writable SQLite file under `~/.synthetic/state`.

## Requirements

1. **Static asset serving**
   - The Elysia server must detect a packaged `public/` directory (next to the binary) or a repo-local `apps/web/dist` directory and serve those files via `@elysiajs/static` with SPA fallbacks.
2. **Compile-friendly env resolution**
   - Database config loads `.env`, `synthetic.env`, or `SYNTHETIC_ENV_FILE` from the binary directory so packaged builds find `DATABASE_URL`.
3. **Release builder**
   - `bun run build:installer` compiles the server (`bun --compile`), runs the Vite build, and assembles a release directory containing `synthetic`, `public/`, and `manifest.json`.
   - The script archives the directory to `dist/install/synthetic-<platform>-<arch>.tar.gz` and emits a matching `.sha256` checksum for GitHub Releases.
4. **Installer script**
   - `scripts/install.sh` detects OS/arch, downloads the matching GitHub release tarball, expands it into `~/.synthetic/releases/<name>`, writes `synthetic.env` with a local SQLite path, and symlinks `synthetic` into `~/.synthetic/bin`.
   - After linking, the script automatically appends the bin directory to the user’s shell PATH (bash/zsh/fish/posix) so `synthetic` is immediately available.
   - Only `SYNTHETIC_VERSION`, `SYNTHETIC_HOME`, and `SYNTHETIC_INSTALL_URL` (for local testing) are configurable so the installer stays small and dependable.
5. **Docs**
   - README highlights the installer command, env overrides, and release build command so contributors know how to publish binaries.

## Task Tracker

- [x] Serve bundled frontend via `@elysiajs/static` with filesystem detection.
- [x] Load runtime env vars from files adjacent to the compiled binary.
- [x] Automate release assembly + checksum generation (`bun run build:installer`).
- [x] Ship curlable installer script with env overrides and PATH guidance.
- [x] Document installer usage and contribution workflow in `README.md`.

## Testing Strategy

- Run `bun run build:installer` on each supported platform to ensure the tarball, checksum, and manifest are generated under `dist/install/`.
- After uploading (or staging) a release artifact, run `SYNTHETIC_VERSION=<tag> scripts/install.sh` (or `SYNTHETIC_INSTALL_URL=file://... scripts/install.sh` for local tarballs) to verify the flow end-to-end and ensure `~/.synthetic/bin/synthetic` launches with the bundled UI. `bun run local:install` automates the local path.
- Smoke-test the installed binary: ensure `/health` responds, frontend loads, migrations run against the generated SQLite database, and `synthetic.env` is respected when edited.
