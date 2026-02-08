# hive

Monorepo project with React + TanStack Start frontend and Elysia backend.

## Documentation Workflow

All planning and requirements live under `docs/` as plain Markdown so any editor (VS Code + Foam, Obsidian, or the web UI we build later) can read and update them. Capture new requirements in `docs/requirements/`, tasks in `docs/tasks/`, tag each with a `theme-*` label for grouping, and link everything back to Hive references as needed. Keep the task order manually in those lists—whatever note sits at the top is what we tackle next.

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

# One-time setup (install deps + push database schema)
bun setup


# Set up local database (create .env with DATABASE_URL="local.db")
# Then run development servers
bun dev
```

### Manual Setup

```bash
# One-time setup (install deps + push database schema)
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
True end-to-end browser testing runs with WebdriverIO (Chromium only for now).

```bash
# Run true E2E flow (starts isolated API + web + dedicated DB)
bun run test:e2e

# Run headed mode for local debugging
bun run test:e2e:headed
```

Notes:
- The E2E harness creates a dedicated temp workspace and SQLite database per run.
- Local dev DB/state are not reused.
- Set `HIVE_E2E_KEEP_ARTIFACTS=1` to keep run logs/artifacts under `tmp/e2e-runs/`.

### Git Hooks & Validation

**Pre-commit** (`bun run check:commit`):
- Linting (Biome)
- Type checking (TypeScript)
- Unit tests (Vitest)
- Security checks (secrets detection, dependency audit)
- Build validation

**Pre-push** (`bun run check:push`):
- Same as pre-commit

## Available Scripts

### Setup
- `bun setup`: One-time setup (install dependencies + push database schema)

### Development
- `bun dev`: Start all applications in development mode
- `bun dev:web`: Start only the web application
- `bun dev:server`: Start only the server

### Building
- `bun build`: Build all applications

### Testing
- `bun test`: Run unit tests in watch mode
- `bun test:run`: Run unit tests once (CI mode)
- `bun test:e2e`: Run WebdriverIO true E2E suite (opt-in)
- `bun test:e2e:headed`: Run WebdriverIO in headed Chromium mode

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
