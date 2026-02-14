# Testing Strategy

## Philosophy

This project uses a **hybrid testing philosophy**:

### Backend Unit Tests (Vitest)
API and business logic tested with Vitest.

**Test location:** `apps/server/src/**/*.test.ts`

```bash
bun -C apps/server run test        # Watch mode
bun -C apps/server run test:run    # CI mode
```

Example targeted run: `bun -C apps/server run test -- src/db.test.ts -t "creates user"`.

### True E2E (Playwright runtime flow)
The opt-in true end-to-end flow lives under `apps/e2e` and validates cell creation + agent chat against a real Hive runtime.

```bash
bun run test:e2e
bun run test:e2e:headed
bun run test:e2e:spec specs/cell-chat.e2e.ts
```

- Pre-push validation must include `bun run test:e2e` (via `bun run check:push`).
- Prefer deterministic assertions (session/messages/metadata) over timing-only waits.
- Keep fixture defaults aligned with runtime providers/models (currently `opencode/big-pickle`).
- Use `HIVE_E2E_KEEP_ARTIFACTS=1` when debugging failures; inspect screenshots/video/trace in `tmp/e2e-runs/`.
- Use `HIVE_E2E_WORKSPACE_MODE=clone` for dev-parity debugging without mutating your real workspace.
- If pre-push fails on the known flaky backend spec (`apps/server/src/__tests__/routes/cells.create.test.ts`), run `bun -C apps/server run test -- src/__tests__/routes/cells.create.test.ts -t "returns detailed payload when template setup fails"` once, then rerun `bun run check:push`.

### Desktop Smoke E2E (WebDriver + Tauri)
Desktop runtime parity checks live under `apps/e2e-desktop` and run WebDriver (`tauri-driver`) against a debug Tauri binary.

```bash
# one-time local setup (best-effort desktop prep included)
bun setup

# rerun desktop setup only
bun run setup:desktop-e2e

bun run test:e2e:desktop
bun run test:e2e:desktop:spec specs/smoke-launch.e2e.mjs
```

- The runner provisions an isolated workspace/db under `tmp/e2e-desktop-runs/` and copies reports to `apps/e2e-desktop/reports/latest`.
- CI runs desktop smoke tests on merge queue/main/manual (non-PR) and executes them under `xvfb-run` on Linux.
- Keep this suite focused on desktop-only risk (window/webview boot, notification bridge, desktop shell integration); keep broad behavior coverage in Playwright.
- Linux local runs need the same WebKit/GTK/Xvfb dependencies as CI; use the commands in `apps/e2e-desktop/README.md`.

### UI Testing (Playwright - Visual Snapshots Only)
All UI testing is done through **visual snapshot testing**. No component unit tests - UI correctness is validated entirely through snapshot comparisons across multiple viewports and themes.

**Test location:** `apps/web/e2e/*.spec.ts`
**Baseline snapshots:** `apps/web/e2e/**/__snapshots__/`

```bash
bun -C apps/web run test:e2e                                  # Run E2E tests (starts full stack via bun run dev)
bun -C apps/web run test:e2e -- e2e/error-states.spec.ts      # Target a single spec
bun -C apps/web run test:e2e:update-snapshots                 # Update snapshots after UI changes
```

**Snapshot coverage:**
- Light/Dark mode
- Desktop/Tablet/Mobile viewports (375x667, 768x1024, 1280x720)

> These Playwright specs are **visual regression tests**, not full E2E flows. They run the real browser shell but stub backend responses with deterministic fixtures so pixel diffs stay meaningful.
>
> - Shared fixture builders live under `apps/web/e2e/utils/` and use seeded Faker plus the Eden/TanStack query types (which mirror the Elysia TypeBox schemas). When the API contract changes, fix the builder once and re-run snapshots.
> - Any route interception must go through those helpers; avoid per-spec JSON blobs.
> - If/when we need “true” E2E coverage, add a separate suite that seeds the database instead of intercepting HTTP.

## Writing Tests

### General Guidelines
- Prefer pure functions. Keep core logic side-effect free; when you need IO helpers, accept only the specific helper you want to swap. For standard modules (`fs`, `path`, `Bun.spawn`), import them directly and use `vi.mock`/`vi.spyOn` in tests when necessary.
- Use real behavior whenever it’s safe: temp directories via `fs.mkdtemp`, short-lived processes, and stub commands. Avoid blanket mocks—mock only when an external dependency can’t be safely exercised or would make tests flaky.
- Every test that touches the host (files, services, ports) must clean up via `finally` blocks to keep the developer’s machine stable.
- Surface errors directly. Tests can assert on the error payload in the view layer; no special retry logic needed.

### Cell & Agent Tests
- Use Vitest for cell logic. Import `fs`, `path`, `Bun.spawn`, etc. directly in production code, and in tests rely on `vi.mock`/`vi.spyOn` to swap only the calls you need (remember to `vi.restoreAllMocks()` in `afterEach`).
- Keep explicit dependency arguments for things we truly swap (e.g., OpenCode client). Provide a tiny fake client in tests so worktree creation, port allocation, and service orchestration stay close to real behavior.
- Template commands in tests should be safe stubs (`echo`, simple scripts) so integration specs exercise orchestration without heavy workloads.

### Backend Tests

**Test business logic and API endpoints**, not implementation details:

```typescript
// Good: Test behavior
test("creates user with valid input", async () => {
  const result = await createUser({ name: "Alice", email: "alice@example.com" })
  expect(result.name).toBe("Alice")
})

// Avoid: Testing internal implementation
test("calls userRepository.insert", async () => { /* ... */ })
```

### Visual Snapshot Tests

**Test complete user journeys**, not isolated components:

```typescript
// Good: Test a flow
test("user can complete checkout", async ({ page }) => {
  await page.goto("/products")
  await page.click("[data-testid='add-to-cart']")
  await page.goto("/cart")
  await expect(page).toHaveScreenshot("cart-with-item.png")
})
```

**When snapshots fail:**
1. Compare `test-results/**/*-diff.png` against the matching baseline in `apps/web/e2e/**/__snapshots__/`.
2. Only update snapshots if the visual change is correct.
3. Never blindly update snapshots to pass tests.

**Workflow for intentional UI changes:**
- Run the targeted spec (e.g. `bun -C apps/web run test:e2e -- e2e/error-states.spec.ts`) as soon as you touch the UI.
- Review the diff images in `apps/web/test-results/`; if the visuals look right, accept them immediately with `bun -C apps/web run test:e2e:update-snapshots`.
- Re-run the spec to confirm it passes, then commit both the code and the refreshed snapshots so the pre-push hook stays green.

## Git Hooks

Run these scripts manually when you need to validate outside the hook flow.

**Pre-commit** (`bun run check:commit`):
- Linting, type checking, unit tests, build validation
- ~5-10 seconds

**Pre-push** (`bun run check:push`):
- Everything from pre-commit + E2E visual snapshot tests
- ~30-60 seconds
