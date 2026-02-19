# hive

Monorepo project with React + TanStack Start frontend and Elysia backend.

## Installation

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/HiveRun/hive/main/scripts/install.sh | bash
```

The installer downloads the latest published release for your platform, expands it into `~/.hive`, writes a local SQLite database path to `hive.env`, symlinks `hive` into `~/.hive/bin`, and updates your shell PATH so the CLI is immediately available. Run `hive` to start the bundled server + UI on the default ports.

During install, Hive also checks for the `opencode` CLI. If missing, it attempts to install OpenCode automatically via `https://opencode.ai/install` so cell chat sessions work out of the box.

Environment variables:
- `HIVE_VERSION`: install a specific tag (defaults to `latest`).
- `HIVE_HOME`: override the install root (defaults to `~/.hive`).
- `HIVE_BIN_DIR`: override the bin directory that `hive` is linked into (defaults to `~/.hive/bin`).
- `HIVE_INSTALL_URL`: override the download URL (handy for testing locally built tarballs).
- `HIVE_MIGRATIONS_DIR`: point the runtime at a custom migrations folder (defaults to the bundled `migrations/`).
- `HIVE_LOG_DIR`: where background logs are written (defaults to `~/.hive/logs` for installed builds, or `<binary>/logs` when running from source).
- `HIVE_PID_FILE`: override the pid file path (defaults to `~/.hive/hive.pid`).
- `HIVE_INSTALL_COMMAND`: override the command executed by `hive upgrade` (defaults to the stored installer behavior).
- `HIVE_SKIP_OPENCODE_INSTALL`: set to `1` to skip OpenCode auto-install.
- `HIVE_OPENCODE_INSTALL_URL`: override the OpenCode installer URL.
- `HIVE_OPENCODE_BIN`: pin the OpenCode executable path written to `hive.env`.

### Using the installed binary

- The installer automatically appends `~/.hive/bin` (or `HIVE_HOME/bin`) to your shell’s PATH for bash, zsh, fish, and other common shells. If you use a custom shell, add it manually:
  ```bash
  export PATH="$HOME/.hive/bin:$PATH"
  ```
- Run the CLI with:
  ```bash
  hive
  ```
  - Compiled releases fork to the background, print the browser URL, log path, and PID file, and immediately return control of your terminal. Releases serve the UI on the API port (`PORT`, defaults to `3000`).
  - The first launch automatically runs the bundled Drizzle migrations; no extra init step is required.
- Follow logs:
  ```bash
  hive logs
  ```
- Stop the background server:
  ```bash
  hive stop
  ```
- Upgrade to the latest published release:
  ```bash
  hive upgrade
  ```
- Inspect your current install (release path, log locations, pid status):
  ```bash
  hive info
  ```
- Open the UI in your default browser (starts the daemon if needed):
  ```bash
  hive web
  ```
- Launch the desktop (Tauri) app. Set `HIVE_TAURI_BINARY` if the CLI
  can’t auto-detect the packaged executable on your system.
  ```bash
  hive desktop
  ```
- Install shell completions (bash/zsh/fish) so they persist across reboots:
  ```bash
  hive completions install zsh
  hive completions install bash
  hive completions install fish
  ```
  Each command picks a sensible default location for that shell (Oh My Zsh custom dir, `~/.local/share/bash-completion/completions`, `~/.config/fish/completions`, etc.). Re-run it whenever new subcommands land or pass an explicit path as the final argument to control where the file is written.
- Need a quick refresher on the available commands? Run `hive --help` for the latest summary.
- Configuration lives in `~/.hive/current/hive.env`. Update values there (or override per run) to change ports, database paths, or feature flags:

  ```bash
  PORT=4100 hive
  ```
- The SQLite database defaults to `~/.hive/state/hive.db`; set `DATABASE_URL` if you need a different location.
- High-frequency transport/polling request logs are muted by default to keep runtime logs readable. Re-enable per category with `HIVE_LOG_TERMINAL_TRAFFIC=1`, `HIVE_LOG_POLLING_TRAFFIC=1`, or `HIVE_LOG_OPTIONS_REQUESTS=1`.

Open the printed UI link (default [http://localhost:3000](http://localhost:3000)) after the log shows “Service supervisor initialized.”

### Building a release locally

```bash
bun run build:installer
ls dist/install
```

This script compiles the Bun server, copies the Vite build output, and packages everything into `dist/install/hive-<platform>-<arch>.tar.gz` plus a `.sha256` checksum. Upload that pair to a GitHub Release so the installer can fetch it. To smoke-test the installer against the locally built artifacts, run:

```bash
bun run local:install
```

This command runs `bun run build:installer` under the hood, then installs from the freshly built tarball using `HIVE_INSTALL_URL=file://...`.

## Getting Started

### With Mise (Recommended)

```bash
# Install tools defined in .tool-versions
mise install

# One-time setup (installs deps, prepares desktop E2E prereqs when possible, pushes DB schema)
bun setup


# Set up local database (create .env with DATABASE_URL="local.db")
# Then run development servers
bun dev
```

### Manual Setup

```bash
# One-time setup (installs deps, prepares desktop E2E prereqs when possible, pushes DB schema)
bun setup

# Set up local database (create .env with DATABASE_URL="local.db")  
# Then run development servers
bun dev
```

**URLs:**
- Web: [http://localhost:3001](http://localhost:3001)
- API: [http://localhost:3000](http://localhost:3000)




## Project Structure

```
hive/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Start)
│   └── server/      # Backend API (Elysia)
├── packages/
│   ├── api/         # API layer / business logic
```

## Testing

This project uses a **hybrid testing philosophy**:

### Backend Unit Tests (Vitest)
API and business logic tested with Vitest.

```bash
# Run unit tests in watch mode
bun test

# Run unit tests once (CI mode)
bun test:run
```

**Test location:** `apps/server/src/**/*.test.ts`

### UI Testing
True end-to-end browser testing runs with Playwright (Chromium only for now).

```bash
# Run true E2E flow (starts isolated API + web + dedicated DB)
bun run test:e2e

# Run headed mode for local debugging
bun run test:e2e:headed

# Open the latest Playwright HTML report
bun run test:e2e:report

# Alias for opening the Playwright report
bun run test:e2e:report:open

# Serve/open the Playwright report directly
bun run test:e2e:report:serve
```

Notes:
- The E2E harness creates a dedicated temp workspace and SQLite database per run.
- Local dev DB/state are not reused.
- `HIVE_HOME` is ephemeral per run by default; set `HIVE_E2E_SHARED_HOME=1` to opt into a shared cache at `tmp/e2e-shared/hive-home` when debugging startup behavior.
- `HIVE_E2E_WORKSPACE_MODE=clone` clones a source repo into the run sandbox (default source is this repo) and registers it as `hive` for closer dev parity.
- `HIVE_E2E_WORKSPACE_SOURCE=/abs/path/to/repo` overrides the clone source when using `HIVE_E2E_WORKSPACE_MODE=clone`.
- By default, the chat spec prefers lightweight templates (`E2E Template`, then `Basic Template`) to avoid heavy setup commands in test runs; set `HIVE_E2E_USE_DEFAULT_TEMPLATE=1` to keep each workspace's configured default template for strict parity debugging.
- Playwright artifacts are copied to `apps/e2e/reports/latest/` (including per-test videos and `playwright-report`).
- Set `HIVE_E2E_KEEP_ARTIFACTS=1` to also keep raw run logs/artifacts under `tmp/e2e-runs/`.

### Desktop Smoke Testing (WebDriver + Tauri)
Desktop-only runtime checks run via WebDriver (`tauri-driver`) against a debug Tauri binary.

Setup (local):

```bash
# One-time setup (includes best-effort desktop WebDriver prep)
bun setup

# Optional: rerun desktop setup only
bun run setup:desktop-e2e

# Ensure Cargo binaries are on PATH for this shell
export PATH="$HOME/.cargo/bin:$PATH"
```

Linux-only system dependencies (required for local desktop smoke on Linux):

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libxdo-dev \
  libssl-dev \
  patchelf \
  webkit2gtk-driver \
  xvfb
```

```bash
# Run desktop smoke suite (Linux/macOS local prerequisites required)
bun run test:e2e:desktop

# Run a single desktop smoke spec
bun run test:e2e:desktop:spec specs/smoke-launch.e2e.mjs

# Linux headless local run (optional)
xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" bun run test:e2e:desktop
```

Notes:
- The desktop harness creates a dedicated temp workspace and SQLite database per run.
- The runner compiles a debug desktop binary via `bun run build:tauri -- --debug --no-bundle` and points the bundled web UI at the ephemeral API URL.
- Desktop artifacts are copied to `apps/e2e-desktop/reports/latest/`.
- Use `HIVE_E2E_KEEP_ARTIFACTS=1` to keep raw logs/artifacts under `tmp/e2e-desktop-runs/`.
- `bun setup` performs desktop WebDriver prep on a best-effort basis; if Cargo is missing it prints follow-up steps instead of failing setup.
- On Linux, setup automatically attempts to install missing desktop packages via `sudo apt-get` and prints manual commands if installation fails.
- If you need deeper setup/troubleshooting notes, see `apps/e2e-desktop/README.md`.

### Git Hooks & Validation

**Pre-commit** (`bun run check:commit`):
- Linting (Biome)
- Type checking (TypeScript)
- Unit tests (Vitest)
- Security checks (secrets detection, dependency audit)
- Build validation

**Pre-push** (`bun run check:push`):
- Same as pre-commit

### GitHub CI (Blacksmith)

- CI runs on Blacksmith-hosted GitHub Actions runners (`blacksmith-2vcpu-ubuntu-2404` for lint/check jobs and `blacksmith-4vcpu-ubuntu-2404` for E2E runtime).
- Workflow triggers on pull requests, merge queue (`merge_group`), pushes to `main`, and manual dispatch.
- `Workflow Lint` runs `actionlint`; `Quality Checks` runs `bun run check:commit`.
- `E2E Runtime Suite` runs `bun run test:e2e` on merge queue (`merge_group`), `main` pushes, and manual dispatch (non-PR), caches Playwright/OpenCode artifacts, and uploads reports from `apps/e2e/reports/latest`.
- `Desktop WebDriver Smoke Suite` runs `bun run test:e2e:desktop` on merge queue (`merge_group`), `main` pushes, and manual dispatch (non-PR), installs `tauri-driver`, executes under `xvfb-run`, and uploads reports from `apps/e2e-desktop/reports/latest`.
- `Security Audit` runs a strict `bun audit --audit-level high` job in non-blocking mode for visibility while dependency remediation is in progress.
- Ensure the Blacksmith GitHub App is installed for your organization before relying on this workflow.

## Available Scripts

### Setup
- `bun setup`: One-time setup (install dependencies, best-effort desktop E2E prep, push database schema)
- `bun run setup:desktop-e2e`: Prepare desktop WebDriver local prerequisites (`tauri-driver` + Linux dependency checks/auto-install)

### Development
- `bun dev`: Start all applications in development mode
- `bun dev:web`: Start only the web application
- `bun dev:server`: Start only the server

### Building
- `bun build`: Build all applications

### Testing
- `bun test`: Run unit tests in watch mode
- `bun test:run`: Run unit tests once (CI mode)
- `bun test:e2e`: Run Playwright true E2E suite (opt-in)
- `bun test:e2e:headed`: Run Playwright in headed Chromium mode
- `bun test:e2e:report`: Open the latest Playwright HTML report
- `bun test:e2e:report:open`: Alias for opening the Playwright report
- `bun test:e2e:report:serve`: Serve/open the Playwright report directly
- `bun test:e2e:desktop`: Run Tauri desktop WebDriver smoke suite
- `bun test:e2e:desktop:spec`: Run one desktop smoke spec by path

### Quality Checks
- `bun check`: Run all pre-commit checks (alias for `check:commit`)
- `bun check:commit`: Run all pre-commit checks (~5-10s)
- `bun check:push`: Run all pre-push checks (same as `check:commit`)
- `bun check-types`: Check TypeScript types across all apps

### Database
- `bun db:push`: Push schema changes to database
- `bun db:studio`: Open database studio UI
- `bun db:generate`: Generate migrations from schema
- `bun db:migrate`: Run migrations

**Local Database Setup:**
Create `.env` file with `DATABASE_URL="local.db"` to use local SQLite.

## AI/LLM Context Management

This project uses [Ruler](https://okigu.com/ruler) to propagate context to AI coding agents (Claude Code, Cursor, Windsurf, etc.).

### Prompt Files Location

All AI-specific prompts live in `.ruler/prompts/`:

```
.ruler/
├── prompts/
│   ├── coding-guidelines.md    # Coding style and error handling
│   └── ...                     # Add more as needed
└── ruler.toml                   # Ruler configuration
```

### Adding New Prompt Files

1. **Create a new file** in `.ruler/prompts/` with a descriptive name (e.g., `architecture.md`, `api-design.md`)

2. **Start with an H1 title** so the concatenated output has clear sections:
   ```markdown
   # Architecture Guidelines

   ## System Design
   ...
   ```

3. **Regenerate agent context** after adding/editing prompt files:
   ```bash
   bun run ruler:apply
   ```

This command:
1. Copies `README.md` → `.ruler/01-readme.md` (prefixed with `01-` for ordering)
2. Ruler automatically discovers all `.md` files in `.ruler/` recursively
3. Propagates the combined content to all AI agent configs

**Note:**
- Generated files (`.ruler/01-readme.md`, `AGENTS.md`, `CLAUDE.md`, etc.) are gitignored
- Only edit source files in `.ruler/prompts/` - never edit generated files directly
- Ruler automatically reads all `.md` files from `.ruler/` directory

### Prompt File Guidelines

- **Keep files focused** - One topic per file (coding, testing, architecture, etc.)
- **Use clear section headers** - Make content scannable for both humans and AI
- **Be concise but complete** - AI agents have token limits
- **Include examples** where helpful - Concrete examples beat abstract rules

### Ripgrep Overrides for Agents

OpenCode's search shell respects `.gitignore` by default, which hides dependencies and build outputs that agents often need to inspect. We keep a project-level `.ignore` file in the repo root with negated patterns for `node_modules`, build directories (`dist`, `build`, `dist-electron`, `apps/server/server`, `src-tauri/target`), cached artifacts (`.turbo`, `.cache`, `tmp`, `temp`), and coverage data. Ripgrep automatically merges these overrides, so agents can still search through those trees without humans having to toggle settings.

If you add new tooling that writes important gitignored files, extend `.ignore` with another `!` pattern so the content remains discoverable to opencode agents.
