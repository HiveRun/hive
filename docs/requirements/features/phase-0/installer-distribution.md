# Installer & Distribution Pipeline

- [x] Installer & Distribution Pipeline #status/complete #phase-0 #feature/distribution

Hive must be installable with a single `curl | bash` command that downloads a compiled Bun binary, its static frontend assets, and a ready-to-use local SQLite database path. This document tracks the requirements for that experience.

## Goals

- Ship a compiled `hive` binary that includes the API and serves the built UI statically.
- Publish platform-specific tarballs (`hive-<platform>-<arch>.tar.gz`) with the binary + frontend assets.
- Provide a curlable installer script that installs/updates releases into `~/.hive` (or a user-defined directory) and links the binary into `~/.hive/bin`.
- Ensure installed builds boot without extra setup by generating `hive.env` pointing to a writable SQLite file under `~/.hive/state`.
- Make `hive` feel like a native dev tool: the default command should start the server/UI in the background, print the local URL + log file, and immediately return control to the user.

## Requirements

1. **Static asset serving**
   - The Elysia server must detect a packaged `public/` directory (next to the binary) or a repo-local `apps/web/dist` directory and serve those files via `@elysiajs/static` with SPA fallbacks.
2. **Compile-friendly env resolution**
   - Database config loads `.env`, `hive.env`, or `HIVE_ENV_FILE` from the binary directory so packaged builds find `DATABASE_URL`.
3. **Release builder**
   - `bun run build:installer` compiles the server (`bun --compile`), runs the Vite build, and assembles a release directory containing `hive`, `public/`, and `manifest.json`.
   - The script archives the directory to `dist/install/hive-<platform>-<arch>.tar.gz` and emits a matching `.sha256` checksum for GitHub Releases.
4. **Installer script**
    - `scripts/install.sh` detects OS/arch, downloads the matching GitHub release tarball, expands it into `~/.hive/releases/<name>`, writes `hive.env` with a local SQLite path, and symlinks `hive` into `~/.hive/bin`.
     - After linking, the script automatically appends the bin directory to the user’s shell PATH (bash/zsh/fish/posix) so `hive` is immediately available.
    - Installer ensures OpenCode CLI is available. If `opencode` is missing, it attempts installation via `https://opencode.ai/install` unless `HIVE_SKIP_OPENCODE_INSTALL=1` is set.
     - Configuration knobs: `HIVE_VERSION`, `HIVE_HOME`, `HIVE_BIN_DIR`, `HIVE_MIGRATIONS_DIR`, `HIVE_LOG_DIR`, `HIVE_PID_FILE`, `HIVE_INSTALL_COMMAND`, and `HIVE_INSTALL_URL` (local testing only) keep the installer flexible without adding flags.

5. **Bundled migrations**
   - The release tarball must include `apps/server/src/migrations` (SQL + `meta/_journal.json`) so compiled binaries can run Drizzle migrations at startup without manual bootstrapping.
6. **CLI ergonomics**
   - The compiled binary should default to background mode (detached process, background log file, clear UI URL, PID file) with built-in commands like `hive stop`, `hive logs`, and `hive upgrade` so users can manage the daemon lifecycle without manual shell hacks. Foreground mode is only exposed via env overrides for debugging—no extra CLI flags are required.
7. **Docs**
   - README highlights the installer command, env overrides, background behavior, and release build command so contributors know how to publish binaries.

## Task Tracker

- [x] Serve bundled frontend via `@elysiajs/static` with filesystem detection.
- [x] Load runtime env vars from files adjacent to the compiled binary.
- [x] Automate release assembly + checksum generation (`bun run build:installer`).
- [x] Ship curlable installer script with env overrides and PATH guidance.
- [x] Document installer usage and contribution workflow in `README.md`.
- [x] Add GitHub Actions CI on Blacksmith runners for `check:commit` + `test:e2e` validation, including merge-queue triggers, workflow linting, and non-blocking strict security audit visibility (E2E runs at merge-queue/main/manual stages rather than every PR checkpoint commit).
- [x] Add CI-only distribution guardrail that validates desktop build + installer smoke flow in an isolated environment.
- [x] Cache Cargo/Tauri artifacts for the CI desktop installer gate to keep runtime stable and faster.
- [x] Align desktop installer gate trigger cadence with E2E (run on merge queue/main/manual, skip PR event).
- [x] Add merge-queue desktop WebDriver smoke coverage (`apps/e2e-desktop`) so Tauri runtime behavior is validated beyond packaging checks.
- [x] Stabilize desktop chat smoke readiness checks so the WDIO suite reliably detects terminal-online state before sending prompts.
- [x] Move desktop WebDriver smoke runs to merge queue/main/manual (skip PR event) so primary PR CI stays fast while desktop runtime parity remains protected pre-merge.

## Testing Strategy

- Run `bun run build:installer` on each supported platform to ensure the tarball, checksum, and manifest are generated under `dist/install/`.
- After uploading (or staging) a release artifact, run `HIVE_VERSION=<tag> scripts/install.sh` (or `HIVE_INSTALL_URL=file://... scripts/install.sh` for local tarballs) to verify the flow end-to-end and ensure `~/.hive/bin/hive` launches with the bundled UI. `bun run local:install` first runs `build:installer`, then shells into `bash scripts/install.sh` with the file:// override to automate the local path.
- Smoke-test the installed binary: ensure `/health` responds, frontend loads, migrations run against the generated SQLite database, and `hive.env` is respected when edited.
- Ensure GitHub Actions CI jobs complete on Blacksmith runners before merge so installer/release changes keep passing `check:commit` and true runtime E2E coverage.
- Ensure CI runs `bun run check:distribution` at merge queue/main/manual stages so desktop bundle generation + installer smoke flow stay protected before trunk merges.
