# synthetic

Monorepo project with React + TanStack Start frontend and Elysia backend.

## Getting Started

```bash
# Install dependencies
bun install

# Start local SQLite database
cd apps/server && bun db:local

# Apply database schema
bun db:push

# Run development servers
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
- `cd apps/server && bun db:local`: Start the local SQLite database
