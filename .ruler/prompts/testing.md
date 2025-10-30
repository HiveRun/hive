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

### UI Testing (Playwright - Visual Snapshots Only)
All UI testing is done through **visual snapshot testing**. No component unit tests - UI correctness is validated entirely through snapshot comparisons across multiple viewports and themes.

**Test location:** `apps/web/e2e/*.spec.ts`
**Baseline snapshots:** `apps/web/e2e/**/__snapshots__/`

```bash
bun -C apps/web run test:e2e                                  # Run E2E tests
bun -C apps/web run test:e2e -- e2e/error-states.spec.ts      # Target a single spec
bun -C apps/web run test:e2e:update-snapshots                 # Update snapshots after UI changes
```

**Snapshot coverage:**
- Light/Dark mode
- Desktop/Tablet/Mobile viewports (375x667, 768x1024, 1280x720)

## Writing Tests

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

## Git Hooks

Run these scripts manually when you need to validate outside the hook flow.

**Pre-commit** (`bun run check:commit`):
- Linting, type checking, unit tests, build validation
- ~5-10 seconds

**Pre-push** (`bun run check:push`):
- Everything from pre-commit + E2E visual snapshot tests
- ~30-60 seconds
