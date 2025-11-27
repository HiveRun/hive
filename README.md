# synthetic

Monorepo project with React + TanStack Start frontend and Elysia backend.

## Legacy Context

Synthetic is the successor to the earlier **Hive** platform (Elixir/Phoenix + Ash + React). We keep Hive's architectural and workflow documentation under `docs/historical/hive` as a reference when translating proven patterns into this Bun/TypeScript monorepo.

## Documentation Workflow

All planning and requirements live under `docs/` as plain Markdown so any editor (VS Code + Foam, Obsidian, or the web UI we build later) can read and update them. Capture new requirements in `docs/requirements/`, tasks in `docs/tasks/`, tag each with a `theme-*` label for grouping, and link everything back to Hive references as needed. Keep the task order manually in those lists—whatever note sits at the top is what we tackle next.

## Installation

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/SyntheticRun/synthetic/main/scripts/install.sh | bash
```

The installer downloads the latest published release for your platform, expands it into `~/.synthetic`, writes a local SQLite database path to `synthetic.env`, symlinks `synthetic` into `~/.synthetic/bin`, and updates your shell PATH so the CLI is immediately available. Run `synthetic` to start the bundled server + UI on the default ports.

Environment variables:
- `SYNTHETIC_VERSION`: install a specific tag (defaults to `latest`).
- `SYNTHETIC_HOME`: override the install root (defaults to `~/.synthetic`).
- `SYNTHETIC_BIN_DIR`: override the bin directory that `synthetic` is linked into (defaults to `~/.synthetic/bin`).
- `SYNTHETIC_INSTALL_URL`: override the download URL (handy for testing locally built tarballs).
- `SYNTHETIC_MIGRATIONS_DIR`: point the runtime at a custom migrations folder (defaults to the bundled `migrations/`).
- `SYNTHETIC_LOG_DIR`: where background logs are written (defaults to `~/.synthetic/logs` for installed builds, or `<binary>/logs` when running from source).
- `SYNTHETIC_PID_FILE`: override the pid file path (defaults to `~/.synthetic/synthetic.pid`).
- `SYNTHETIC_INSTALL_COMMAND`: override the command executed by `synthetic upgrade` (defaults to the stored installer behavior).

### Using the installed binary

- The installer automatically appends `~/.synthetic/bin` (or `SYNTHETIC_HOME/bin`) to your shell’s PATH for bash, zsh, fish, and other common shells. If you use a custom shell, add it manually:
  ```bash
  export PATH="$HOME/.synthetic/bin:$PATH"
  ```
- Run the CLI with:
  ```bash
  synthetic
  ```
  - Compiled releases fork to the background, print the browser URL, log path, and PID file, and immediately return control of your terminal. Releases serve the UI on the API port (`PORT`, defaults to `3000`).
  - The first launch automatically runs the bundled Drizzle migrations; no extra init step is required.
- Follow logs:
  ```bash
  synthetic logs
  ```
- Stop the background server:
  ```bash
  synthetic stop
  ```
- Upgrade to the latest published release:
  ```bash
  synthetic upgrade
  ```
- Inspect your current install (release path, log locations, pid status):
  ```bash
  synthetic info
  ```
- Open the UI in your default browser (starts the daemon if needed):
  ```bash
  synthetic web
  ```
- Launch the desktop (Tauri) app. Set `SYNTHETIC_TAURI_BINARY` if the CLI
  can’t auto-detect the packaged executable on your system.
  ```bash
  synthetic tauri
  ```
- Install shell completions (bash/zsh/fish) so they persist across reboots:
  ```bash
  synthetic completions install zsh
  synthetic completions install bash
  synthetic completions install fish
  ```
  Each command picks a sensible default location for that shell (Oh My Zsh custom dir, `~/.local/share/bash-completion/completions`, `~/.config/fish/completions`, etc.). Re-run it whenever new subcommands land or pass an explicit path as the final argument to control where the file is written.
- Need a quick refresher on the available commands? Run `synthetic --help` for the latest summary.
- Configuration lives in `~/.synthetic/current/synthetic.env`. Update values there (or override per run) to change ports, database paths, or feature flags:

  ```bash
  PORT=4100 synthetic
  ```
- The SQLite database defaults to `~/.synthetic/state/synthetic.db`; set `DATABASE_URL` if you need a different location.

Open the printed UI link (default [http://localhost:3000](http://localhost:3000)) after the log shows “Service supervisor initialized.”

### Building a release locally

```bash
bun run build:installer
ls dist/install
```

This script compiles the Bun server, copies the Vite build output, and packages everything into `dist/install/synthetic-<platform>-<arch>.tar.gz` plus a `.sha256` checksum. Upload that pair to a GitHub Release so the installer can fetch it. To smoke-test the installer against the locally built artifacts, run:

```bash
bun run local:install
```

This command runs `bun run build:installer` under the hood, then installs from the freshly built tarball using `SYNTHETIC_INSTALL_URL=file://...`.

## Getting Started

### With Mise (Recommended)

```bash
# Install tools defined in .tool-versions
mise install

# One-time setup (install deps + push database schema)
bun setup

# Install Playwright browsers (for E2E testing)
cd apps/web && bunx playwright install --with-deps

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
synthetic/
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

### UI Testing (Playwright - Visual Snapshots Only)
All UI testing is done through **visual snapshot testing**. No component unit tests - UI correctness is validated entirely through snapshot comparisons across multiple viewports and themes.

```bash
# Run E2E tests
bun test:e2e

# Run with interactive UI (debugging)
bun test:e2e:ui

# Run in headed mode (see browser)
bun test:e2e:headed
```

**Test location:** `apps/web/e2e/*.spec.ts`
**Snapshots location:** `apps/web/e2e/**/__snapshots__/`

**Snapshot coverage:**
- Light/Dark mode
- Desktop/Tablet/Mobile viewports (375x667, 768x1024, 1280x720)

#### Updating Snapshots After UI Changes

When you intentionally change the UI (styling, layout, content), snapshot tests will fail. This is expected.

**To update snapshots:**

```bash
# Update all snapshots
bun test:e2e:update-snapshots
```

**When to update:**
- ✅ After intentional design changes
- ✅ After adding/removing UI elements
- ✅ After changing text content or images
- ❌ Never update to "fix" a failing test without understanding why it failed

**Workflow for UI changes:**
1. Make your UI changes
2. Run `bun test:e2e` - tests will fail showing visual diffs
3. Review the diff images in `test-results/` to verify changes look correct
4. Run `bun test:e2e:update-snapshots` to accept the new visuals
5. Commit both your code changes AND the updated snapshot images

## Voice Input (Beta)

Synthetic now ships optional push-to-talk controls in the agent chat experience. To enable voice input:

1. Update `synthetic.config.ts` with a `voice` block. Local mode is the default and spins up a bundled Whisper (Transformers.js) transcriber on demand. Remote mode forwards the audio to providers such as OpenAI or Groq via the Vercel AI SDK.
2. If you pick a remote provider, expose the API key via the referenced environment variable (defaults are `OPENAI_API_KEY` or `GROQ_API_KEY`). Remote mode automatically selects our recommended Whisper variant for that provider (OpenAI `whisper-1`, Groq `whisper-large-v3-turbo`).
3. Restart the server so `/api/voice/config` and `/api/voice/transcriptions` pick up the new settings.
4. Visit the agent chat UI — a microphone button appears inside the compose panel when browser recording is allowed.

```ts
// Local (default)
voice: {
  enabled: true,
  transcription: {
    mode: "local",
    model: "Xenova/whisper-small",
    language: "en",
  },
},

// Remote example
voice: {
  enabled: true,
  transcription: {
    mode: "remote",
    provider: "openai", // or "groq"
    language: "en",
    apiKeyEnv: "OPENAI_API_KEY",
  },
},
```

Local models are cached under `.synthetic/models` and the first transcription run downloads them automatically. All audio is captured in-browser, converted to WAV, sent once to `/api/voice/transcriptions`, and discarded when a transcript is returned.

#### Debugging Failed Snapshot Tests

When snapshot tests fail, Playwright generates several artifacts to help debug:

**Test Artifacts Location:** `apps/web/test-results/`

For each failed test, you'll find:
- **`*-actual.png`** - What was actually rendered
- **`*-diff.png`** - Visual diff highlighting changes (red = pixels that changed)
- **`trace.zip`** - Full test trace with network logs, console output, DOM snapshots
- **`test-failed-*.png`** - Screenshot at the point of failure

**For AI Agents:**
All these files are accessible via the Read tool. When a test fails:
1. Read the `-actual.png` to see what was rendered
2. Read the `-diff.png` to see exactly what changed
3. Compare with the expected snapshot in `e2e/**/__snapshots__/`
4. Review the trace file for network/console errors if needed

**For Humans:**
Open the HTML report to view traces interactively:
```bash
npx playwright show-report
```

### Git Hooks & Validation

**Pre-commit** (`bun run check:commit`):
- Linting (Biome)
- Type checking (TypeScript)
- Unit tests (Vitest)
- Security checks (secrets detection, dependency audit)
- Build validation

**Pre-push** (`bun run check:push`):
- Everything from pre-commit
- E2E tests (Playwright with visual snapshots)

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
- `bun test:e2e`: Run E2E tests
- `bun test:e2e:ui`: Run E2E tests with interactive UI
- `bun test:e2e:headed`: Run E2E tests in headed mode (see browser)
- `bun test:e2e:update-snapshots`: Update visual snapshots

### Quality Checks
- `bun check`: Run all pre-commit checks (alias for `check:commit`)
- `bun check:commit`: Run all pre-commit checks (~5-10s)
- `bun check:push`: Run all pre-push checks (~30-60s with E2E tests)
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
